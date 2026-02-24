import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { TributaryClient, TributaryStream, SyncStatus as TributarySyncStatus } from 'tributary-client'
import { indexAll, localMigrations } from 'scribe-data'

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
  focusedLibraryId: string | null
  setFocusedLibrary: (id: string | null) => void
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
  const [focusedLibraryId, setFocusedLibrary] = useState<string | null>(null)
  const focusedLibraryRef = useRef<string | null>(null)

  // Keep ref in sync so the async sync loop can read the latest value
  useEffect(() => {
    focusedLibraryRef.current = focusedLibraryId
  }, [focusedLibraryId])

  // Track tab visibility so the sync loop can back off when hidden
  const visibleRef = useRef(!document.hidden)
  const wakeUpRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const onVisibilityChange = () => {
      const wasVisible = visibleRef.current
      visibleRef.current = !document.hidden
      console.log(`[sync] visibilitychange: ${wasVisible ? 'visible' : 'hidden'} → ${document.hidden ? 'hidden' : 'visible'}`, { hasWakeUp: !!wakeUpRef.current })
      // When the tab becomes visible again, restart the sync loop immediately
      if (!document.hidden) {
        if (wakeUpRef.current) {
          wakeUpRef.current()
        } else {
          console.warn('[sync] visibilitychange: wakeUpRef is null, cannot restart sync')
        }
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  // Start background sync thread
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>
    let isMounted = true
    let isRunning = false // guard against concurrent execution
    let pendingWakeUp = false // track wakeUp calls that arrived mid-sync

    // Re-sync in case visibility changed between effect cleanup and re-mount
    // (e.g. during React StrictMode double-mount)
    visibleRef.current = !document.hidden

    // Local mirror of per-library sync status, updated in the loop and
    // pushed to React state between async yields so the UI can re-render.
    let latestPerStream: Record<string, SyncStatus> = {}

    const pushStatus = () => {
      const snapshot = { ...latestPerStream }
      setSyncStatus(snapshot)

      const statuses = Object.values(snapshot)
      const allComplete = statuses.length === 0 || statuses.every(s => s.synced)
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

    const scheduleNext = (delay: number) => {
      timeoutId = setTimeout(syncLoop, delay)
    }

    // Compute the delay for the next sync iteration based on tab visibility
    // and sync completeness.
    const nextDelay = (allComplete: boolean) => {
      if (!visibleRef.current) return pollInterval * 30 // ~30s background
      return allComplete ? pollInterval : 10
    }

    const syncLoop = async () => {
      if (!isMounted) { console.log('[sync] syncLoop: not mounted, skipping'); return }

      // If the tab is hidden, skip the work entirely and just reschedule.
      // The wakeUp callback will restart us immediately when the tab returns.
      if (!visibleRef.current) {
        console.log(`[sync] tab hidden, sleeping for ${pollInterval * 30}ms`)
        scheduleNext(pollInterval * 30)
        return
      }

      // Prevent concurrent execution — the wakeUp function handles setting
      // pendingWakeUp when a sync is already in-flight.
      if (isRunning) return
      isRunning = true
      pendingWakeUp = false

      setGlobalSyncStatus(prev => ({ ...prev, isSyncing: true, hasError: false }))

      try {
        // Load all libraries into memory
        const streamIds = await client.list()
        const streams: Array<{ id: string, stream: TributaryStream }> = []
        for (const streamId of streamIds) {
          const stream = await client.get('scribe', streamId)
          if (stream) streams.push({ id: streamId, stream })
        }

        if (!isMounted) { isRunning = false; return }

        // When a focused library is set, only sync that library
        const focused = focusedLibraryRef.current
        const streamsToSync = focused
          ? streams.filter(s => s.id === focused)
          : streams

        // Sync each library in a small batch, updating UI after each
        for (const { id, stream } of streamsToSync) {
          if (!isMounted) { isRunning = false; return }

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
            console.error(`Error syncing library ${id}:`, err)
            latestPerStream[id] = {
              ...latestPerStream[id],
              isSyncing: false,
              hasError: true,
            }
          }
          pushStatus()
        }

        if (!isMounted) { isRunning = false; return }

        // Reindex synced libraries so notes appear in the UI
        for (const { stream } of streamsToSync) {
          if (!isMounted) { isRunning = false; return }
          try {
            // Ensure local-only tables exist (idempotent; needed for streams
            // loaded via sync that never went through initializeLibrary)
            await localMigrations(stream.local())
            await indexAll(stream.local())
          } catch (error) {
            console.error('Error reindexing library:', error)
          }
        }

        const allComplete = pushStatus()
        isRunning = false
        if (pendingWakeUp) {
          pendingWakeUp = false
          scheduleNext(0)
        } else {
          scheduleNext(nextDelay(allComplete))
        }
      } catch (error) {
        console.error('Background sync error:', error)
        setGlobalSyncStatus(prev => ({ ...prev, isSyncing: false, hasError: true }))
        isRunning = false
        if (pendingWakeUp) {
          pendingWakeUp = false
          scheduleNext(0)
        } else {
          // On error use 5× poll interval, but still respect background throttle
          const errorDelay = visibleRef.current ? pollInterval * 5 : pollInterval * 30
          scheduleNext(errorDelay)
        }
      }
    }

    // Allow the visibility handler to cancel a long background timeout
    // and restart the loop immediately when the tab becomes visible.
    wakeUpRef.current = () => {
      clearTimeout(timeoutId)
      if (isRunning) {
        // A sync is already in-flight — flag it so the running iteration
        // restarts the loop immediately when it finishes.
        console.log('[sync] wakeUp: sync in-flight, setting pendingWakeUp')
        pendingWakeUp = true
      } else {
        console.log('[sync] wakeUp: starting syncLoop')
        syncLoop()
      }
    }

    syncLoop()

    return () => {
      isMounted = false
      wakeUpRef.current = null
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
    focusedLibraryId,
    setFocusedLibrary,
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

const defaultSyncStatus: SyncStatus = {
  synced: false,
  isSyncing: false,
  currentIndex: 0,
  finalIndex: 0,
  lastSyncedAt: null,
  hasError: false,
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
