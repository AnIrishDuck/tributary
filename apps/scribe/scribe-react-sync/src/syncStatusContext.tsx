import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { TributaryClient } from 'tributary-client'
import { SyncStatus, SyncStatusState, defaultSyncStatus } from './types.js'
import { SyncLoop } from './syncLoop.js'

export interface SyncStatusContextType {
  syncStatus: Record<string, SyncStatus>
  globalSyncStatus: SyncStatus
  syncStream: (streamId: string, max?: number) => Promise<void>
  syncAll: (max?: number) => Promise<void>
  isSyncingAny: boolean
  focusedLibraryId: string | null
  setFocusedLibrary: (id: string | null) => void
  /** Trigger an immediate restart of the background sync loop. */
  requestSync: () => void
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
    lastEdited: null,
    libraryTitle: null,
  })
  const [focusedLibraryId, setFocusedLibraryState] = useState<string | null>(null)
  const loopRef = useRef<SyncLoop | null>(null)

  // Start the sync loop
  useEffect(() => {
    const loop = new SyncLoop({
      client,
      pollInterval,
      onStatusChange: (state: SyncStatusState) => {
        setSyncStatus(state.perStream)
        setGlobalSyncStatus(prev => ({
          ...state.global,
          // Preserve lastSyncedAt from previous state when not complete
          lastSyncedAt: state.global.synced ? new Date() : prev.lastSyncedAt,
        }))
      },
    })
    loopRef.current = loop

    // Wire up visibility change handler
    const onVisibilityChange = () => {
      if (!document.hidden) {
        loop.wakeUp()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    loop.start()

    return () => {
      loop.stop()
      loopRef.current = null
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [client, pollInterval])

  // Keep the loop's focused library in sync with React state
  const setFocusedLibrary = useCallback((id: string | null) => {
    setFocusedLibraryState(id)
    if (loopRef.current) {
      loopRef.current.setFocusedLibrary(id)
    }
  }, [])

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

  const requestSync = useCallback(() => {
    if (loopRef.current) {
      loopRef.current.wakeUp()
    }
  }, [])

  const value: SyncStatusContextType = {
    syncStatus,
    globalSyncStatus,
    syncStream,
    syncAll,
    isSyncingAny,
    focusedLibraryId,
    setFocusedLibrary,
    requestSync,
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

/** Like useSyncStatus but returns a default value when no provider is present */
export const useSyncStatusOptional = (): SyncStatusContextType | null => {
  return useContext(SyncStatusContext) ?? null
}

// Helper function to check if a library is synced
export const useIsLibrarySynced = (streamId: string): boolean => {
  const { syncStatus } = useSyncStatus()
  return syncStatus[streamId]?.synced ?? false
}
