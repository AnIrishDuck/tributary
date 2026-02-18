import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { TributaryClient, TributaryStream } from 'tributary-client'
import { indexAll } from 'scribe-data'

export interface SyncStatus {
  synced: boolean
  isSyncing: boolean
  pendingBlobs: number
  lastSyncedAt: Date | null
}

export interface SyncStatusContextType {
  syncStatus: Record<string, SyncStatus>
  globalSyncStatus: SyncStatus
  syncStream: (streamId: string, max?: number) => Promise<void>
  syncAll: (max?: number) => Promise<void>
  isSyncingAny: boolean
}

const SyncStatusContext = createContext<SyncStatusContextType | undefined>(undefined)

export const SyncStatusProvider: React.FC<{
  client: TributaryClient
  children: ReactNode
  pollInterval?: number
}> = ({ client, children, pollInterval = 1000 }) => {
  const [syncStatus, setSyncStatus] = useState<Record<string, SyncStatus>>({})
  const [globalSyncStatus, setGlobalSyncStatus] = useState<SyncStatus>({
    synced: true,  // Start as synced to allow immediate editing in tests
    isSyncing: false,
    pendingBlobs: -1,
    lastSyncedAt: null,
  })

  // Start background sync thread
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>
    let isMounted = true

    const syncLoop = async () => {
      if (!isMounted) return

      setGlobalSyncStatus(prev => ({ ...prev, isSyncing: true }))

      try {
        // Sync all streams with small batch size
        const isFullySynced = await client.sync(100)

        if (!isMounted) return

        // Reindex all streams after sync to ensure authoritative versions are up to date
        // This is necessary because the background sync doesn't automatically trigger reindexing
        const streamIds = await client.list()
        for (const streamId of streamIds) {
          const stream = await client.get('scribe', streamId)
          if (stream) {
            try {
              const localDb = stream.local()
              await indexAll(localDb)
            } catch (error) {
              console.error(`Error reindexing stream ${streamId}:`, error)
              // Continue with other streams even if one fails
            }
          }
        }

        if (!isMounted) return

        // Update sync status for each stream
        const newSyncStatus: Record<string, SyncStatus> = {}

        for (const streamId of streamIds) {
          const stream = await client.get('scribe', streamId)
          if (stream) {
            // Get the last sync index for this stream
            // This is a simplified approach - in production we'd track this more accurately
            const localDb = stream.local()
            const result: any = await localDb.query(
              `SELECT last_sync_index FROM tributary.streams WHERE id = $1`,
              [streamId]
            )

            let pendingBlobs = -1
            if (result.rows && result.rows.length > 0) {
              const lastSyncIndex = result.rows[0].last_sync_index || 0
              // Get total blob count from server
              const serverBlobs = await (client as any).server.getAllBlobMetadata(
                streamId,
                0,
                undefined
              )
              pendingBlobs = Math.max(0, serverBlobs.totalCount - lastSyncIndex)
            }

            newSyncStatus[streamId] = {
              synced: isFullySynced,
              isSyncing: false,
              pendingBlobs,
              lastSyncedAt: isFullySynced ? new Date() : null,
            }
          }
        }

        setSyncStatus(newSyncStatus)

        // Calculate global sync status
        const allSynced = streamIds.every(id => newSyncStatus[id]?.synced)
        const anySyncing = streamIds.some(id => newSyncStatus[id]?.isSyncing)

        setGlobalSyncStatus({
          synced: allSynced,
          isSyncing: anySyncing,
          pendingBlobs: streamIds.reduce((sum, id) => {
            const status = newSyncStatus[id]
            return status && status.pendingBlobs >= 0 ? sum + status.pendingBlobs : sum
          }, 0),
          lastSyncedAt: allSynced ? new Date() : globalSyncStatus.lastSyncedAt,
        })

        // Schedule next sync
        if (isFullySynced) {
          // Poll less frequently when fully synced
          timeoutId = setTimeout(syncLoop, pollInterval * 10)
        } else {
          // Poll more frequently when syncing
          timeoutId = setTimeout(syncLoop, pollInterval)
        }
      } catch (error) {
        console.error('Background sync error:', error)
        // Still schedule next sync to retry
        timeoutId = setTimeout(syncLoop, pollInterval)
      }
    }

    syncLoop()

    return () => {
      isMounted = false
      clearTimeout(timeoutId)
    }
  }, [client, pollInterval])

  // Manual sync functions
  const syncStream = useCallback(async (streamId: string, max: number = 10) => {
    const stream = await client.get('scribe', streamId)
    if (stream) {
      await stream.sync(max)
    }
  }, [client])

  const syncAll = useCallback(async (max: number = 10) => {
    await client.sync(max)
  }, [client])

  const isSyncingAny = Object.values(syncStatus).some(status => status.isSyncing)

  const value: SyncStatusContextType = {
    syncStatus,
    globalSyncStatus,
    syncStream,
    syncAll,
    isSyncingAny,
  }

  return (
    <SyncStatusContext.Provider value={value}>
      {children}
    </SyncStatusContext.Provider>
  )
}

export const useSyncStatus = () => {
  const context = useContext(SyncStatusContext)
  if (!context) {
    throw new Error('useSyncStatus must be used within a SyncStatusProvider')
  }
  return context
}

// Helper function to check if a stream is synced
export const useIsStreamSynced = (streamId: string): boolean => {
  const { syncStatus } = useSyncStatus()
  return syncStatus[streamId]?.synced ?? false
}
