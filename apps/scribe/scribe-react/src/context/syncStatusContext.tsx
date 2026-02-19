import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { TributaryClient, TributaryStream, SyncStatus as TributarySyncStatus } from 'tributary-client'
import { indexAll } from 'scribe-data'

export interface SyncStatus {
  synced: boolean
  isSyncing: boolean
  currentIndex: number
  finalIndex: number
  lastSyncedAt: Date | null
  hasError: boolean
}

export interface SyncStatusContextType {
  syncStatus: Record<string, SyncStatus>
  globalSyncStatus: SyncStatus
  syncStream: (streamId: string, max?: number) => Promise<void>
  syncAll: (max?: number) => Promise<void>
  isSyncingAny: boolean
  focusedStreamId: string | null
  setFocusedStream: (id: string | null) => void
}

const SyncStatusContext = createContext<SyncStatusContextType | undefined>(undefined)

export const SyncStatusProvider: React.FC<{
  client: TributaryClient
  children: ReactNode
  pollInterval?: number
}> = ({ client, children, pollInterval = 1000 }) => {
  const [syncStatus, setSyncStatus] = useState<Record<string, SyncStatus>>({})
  const [globalSyncStatus, setGlobalSyncStatus] = useState<SyncStatus>({
    synced: false,
    isSyncing: true,
    currentIndex: 0,
    finalIndex: 0,
    lastSyncedAt: null,
    hasError: false,
  })
  const [focusedStreamId, setFocusedStream] = useState<string | null>(null)
  const focusedStreamRef = useRef<string | null>(null)

  // Keep ref in sync so the async sync loop can read the latest value
  useEffect(() => {
    focusedStreamRef.current = focusedStreamId
  }, [focusedStreamId])

  // Start background sync thread
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>
    let isMounted = true

    // Local mirror of per-stream sync status, updated in the loop and
    // pushed to React state between async yields so the UI can re-render.
    let latestPerStream: Record<string, SyncStatus> = {}

    const pushStatus = () => {
      const snapshot = { ...latestPerStream }
      setSyncStatus(snapshot)

      const statuses = Object.values(snapshot)
      const allComplete = statuses.length > 0 && statuses.every(s => s.synced)
      const anyError = statuses.some(s => s.hasError)
      const totalCurrent = statuses.reduce((sum, s) => sum + s.currentIndex, 0)
      const totalFinal = statuses.reduce((sum, s) => sum + s.finalIndex, 0)
      setGlobalSyncStatus(prev => ({
        synced: allComplete,
        isSyncing: !allComplete,
        currentIndex: totalCurrent,
        finalIndex: totalFinal,
        lastSyncedAt: allComplete ? new Date() : prev.lastSyncedAt,
        hasError: anyError,
      }))
      return allComplete
    }

    const syncLoop = async () => {
      if (!isMounted) return

      setGlobalSyncStatus(prev => ({ ...prev, isSyncing: true, hasError: false }))

      try {
        // Load all streams into memory
        const streamIds = await client.list()
        const streams: Array<{ id: string, stream: TributaryStream }> = []
        for (const streamId of streamIds) {
          const stream = await client.get('scribe', streamId)
          if (stream) streams.push({ id: streamId, stream })
        }

        if (!isMounted) return

        // When a focused stream is set, only sync that stream
        const focused = focusedStreamRef.current
        const streamsToSync = focused
          ? streams.filter(s => s.id === focused)
          : streams

        // Sync each stream in a small batch, updating UI after each
        for (const { id, stream } of streamsToSync) {
          if (!isMounted) return

          try {
            const tributaryStatus = await stream.sync(10)
            const isComplete = tributaryStatus.complete()

            latestPerStream[id] = {
              synced: isComplete,
              isSyncing: !isComplete,
              currentIndex: tributaryStatus.currentIndex,
              finalIndex: tributaryStatus.finalIndex,
              lastSyncedAt: isComplete ? new Date() : null,
              hasError: !!tributaryStatus.error,
            }
          } catch (err) {
            console.error(`Error syncing stream ${id}:`, err)
            latestPerStream[id] = {
              ...latestPerStream[id],
              isSyncing: false,
              hasError: true,
            }
          }
          pushStatus()
        }

        if (!isMounted) return

        // Reindex synced streams so documents appear in the UI
        for (const { stream } of streamsToSync) {
          if (!isMounted) return
          try {
            const localDb = stream.local()
            await indexAll(localDb)
          } catch (error) {
            console.error('Error reindexing stream:', error)
          }
        }

        // Schedule next sync - fast when actively syncing, slow when idle
        const allComplete = pushStatus()
        timeoutId = setTimeout(syncLoop, allComplete ? pollInterval : 10)
      } catch (error) {
        console.error('Background sync error:', error)
        setGlobalSyncStatus(prev => ({ ...prev, isSyncing: false, hasError: true }))
        timeoutId = setTimeout(syncLoop, pollInterval * 5)
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
    focusedStreamId,
    setFocusedStream,
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
