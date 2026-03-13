import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { TributaryClient, TributaryStream, SyncStatus as TributarySyncStatus } from 'tributary-client'
import { indexAll, localMigrations, getLastEditedTime, getLibraryDisplayName, upsertLinkedLibrary, seedLinkedLibrariesCache, getLinkedLibraries } from 'scribe-data'

type SyncFocus = { type: 'home' } | { type: 'library'; id: string }

export interface SyncStatus {
  synced: boolean
  isSyncing: boolean
  currentIndex: number
  finalIndex: number
  lastSyncedAt: Date | null
  hasError: boolean
  /** Most recent note edit time (ISO string), populated by the sync loop. */
  lastEdited: string | null
  /** Library display name, populated by the sync loop. */
  libraryTitle: string | null
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
    lastEdited: null,
    libraryTitle: null,
  })
  const [focusedLibraryId, setFocusedLibraryRaw] = useState<string | null>(null)
  const focusedLibraryRef = useRef<string | null>(null)

  // Wrap setFocusedLibrary to also wake up the sync loop immediately
  const setFocusedLibrary = useCallback((id: string | null) => {
    setFocusedLibraryRaw(id)
    focusedLibraryRef.current = id
    if (id && wakeUpRef.current) {
      wakeUpRef.current()
    }
  }, [])

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
    let hasRunOnce = false // skip visibility sleep until first sync completes
    let roundRobinIndex = 0 // tracks which library to sync next in Home mode

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
        ...prev,
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
    // and sync completeness.  Read document.hidden directly so a stale
    // visibleRef (from a spurious visibilitychange on page load) can't
    // permanently stall sync.
    const nextDelay = (allComplete: boolean) => {
      if (document.hidden) return pollInterval * 30 // ~30s background
      return allComplete ? pollInterval * 15 : 10 // 15s idle, 10ms when syncing
    }

    const syncLoop = async () => {
      if (!isMounted) { console.log('[sync] syncLoop: not mounted, skipping'); return }

      // Always run the first sync regardless of tab visibility.  Browsers
      // can fire a spurious visibilitychange (visible→hidden) during page
      // load — or report document.hidden=true during navigation — while the
      // tab is actually visible.  Sleeping on the very first iteration would
      // leave the user staring at "loading your libraries" for 30+ seconds
      // until the next check self-corrects.
      if (hasRunOnce && document.hidden) {
        visibleRef.current = false
        console.log(`[sync] tab hidden, sleeping for ${pollInterval * 30}ms`)
        scheduleNext(pollInterval * 30)
        return
      }
      visibleRef.current = !document.hidden

      // Prevent concurrent execution — the wakeUp function handles setting
      // pendingWakeUp when a sync is already in-flight.
      if (isRunning) { console.log('[sync] syncLoop: already running, skipping'); return }
      isRunning = true
      pendingWakeUp = false

      try {
        // Load all libraries into memory
        const streamIds = await client.list()
        const streams: Array<{ id: string, stream: TributaryStream }> = []
        for (const streamId of streamIds) {
          const stream = await client.get('scribe', streamId)
          if (stream) streams.push({ id: streamId, stream })
        }

        if (!isMounted) { isRunning = false; return }

        // Determine sync focus
        const focused = focusedLibraryRef.current
        const syncFocus: SyncFocus = focused
          ? { type: 'library', id: focused }
          : { type: 'home' }

        const homeStreamId = await client.getHomeStream()

        let streamsToSync: Array<{ id: string; stream: TributaryStream }>
        if (syncFocus.type === 'library') {
          streamsToSync = streams.filter(s => s.id === syncFocus.id)
          // If the focused library isn't registered yet (e.g. direct-link to
          // a linked library on fresh login), also sync the home stream so the
          // linked library can be discovered and registered.
          if (streamsToSync.length === 0 && homeStreamId) {
            const homeEntry = streams.find(s => s.id === homeStreamId)
            if (homeEntry) {
              streamsToSync = [homeEntry]
              console.log(`[sync] focus: library ${syncFocus.id} (not found, syncing home to discover)`)
            } else {
              console.log(`[sync] focus: library ${syncFocus.id} (not found, no home stream)`)
            }
          } else {
            console.log(`[sync] focus: library ${syncFocus.id}`)
          }
        } else {
          // Round-robin: sync one library per tick
          if (streams.length > 0) {
            const index = roundRobinIndex % streams.length
            streamsToSync = [streams[index]]
            const isHome = streams[index].id === homeStreamId
            const label = isHome ? '*home* library' : 'library'
            console.log(`[sync] focus: Home, round-robin ${index + 1}/${streams.length}, syncing ${label} ${streams[index].id}`)
            roundRobinIndex = (index + 1) % streams.length
          } else {
            streamsToSync = []
            console.log('[sync] focus: Home, no libraries to sync')
          }
        }

        // Sync the selected library, tracking whether any data changed.
        // Don't mark streams as `synced` yet — wait until localMigrations
        // and indexAll have run so pages that depend on local tables
        // (authoritative_version, indexed_block, etc.) don't see
        // synced=true before those tables exist.
        let hadChanges = false
        const completedStreams = new Set<string>()
        for (const { id, stream } of streamsToSync) {
          if (!isMounted) { isRunning = false; return }

          try {
            const prevStatus = latestPerStream[id]
            const tributaryStatus = await stream.sync(10)
            const isComplete = tributaryStatus.complete()

            // Detect whether anything changed since the last sync
            if (!prevStatus ||
                prevStatus.currentIndex !== tributaryStatus.currentIndex ||
                prevStatus.finalIndex !== tributaryStatus.finalIndex) {
              hadChanges = true
            }

            if (isComplete) completedStreams.add(id)

            latestPerStream[id] = {
              ...latestPerStream[id],
              // Preserve previous synced state — only promote to true after
              // localMigrations + indexAll finish (below).
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
            hadChanges = true // treat errors as "changed" to avoid fast-looping
          }
          pushStatus()
        }

        if (!isMounted) { isRunning = false; return }

        // Reindex synced libraries so notes appear in the UI.
        // Skip when nothing changed to avoid unnecessary DB writes
        // (rebuildSlugCollisions rewrites its entire table on every call).
        if (hadChanges) {
          // Resolve the home stream's local DB once for caching linked library metadata
          let homeLocal: Awaited<ReturnType<TributaryStream['local']>> | null = null
          if (homeStreamId) {
            const homeEntry = streams.find(s => s.id === homeStreamId)
            if (homeEntry) homeLocal = homeEntry.stream.local()
          }

          for (const { id, stream } of streamsToSync) {
            if (!isMounted) { isRunning = false; return }
            try {
              // Ensure local-only tables exist (idempotent; needed for streams
              // loaded via sync that never went through initializeLibrary).
              // This must complete before marking synced so pages that query
              // local tables (authoritative_version, indexed_block, etc.)
              // never see synced=true before those tables exist.
              await localMigrations(stream.local())

              // Mark as synced now that local tables are ready. indexAll and
              // metadata queries below may fail (e.g. empty streams without
              // synced schema) but the page should still see synced=true so
              // it can show a schema error instead of loading forever.
              latestPerStream[id] = {
                ...latestPerStream[id],
                synced: completedStreams.has(id) || (latestPerStream[id]?.synced ?? false),
              }

              await indexAll(stream.local())

              // Compute library metadata alongside indexing so the home page
              // never needs to fire independent queries per library.
              const lastEdited = await getLastEditedTime(stream.local())
              const libraryTitle = await getLibraryDisplayName(stream)

              latestPerStream[id] = {
                ...latestPerStream[id],
                lastEdited,
                libraryTitle,
              }

              // When the home stream finishes syncing, seed the linked_libraries
              // cache from its collection table so the home page can render
              // immediately on next load without initializing every stream.
              // Also register linked library streams so the sync loop can
              // discover and sync them on subsequent ticks (critical for
              // direct-link navigation that skips the home page).
              if (id === homeStreamId && homeLocal) {
                try {
                  await seedLinkedLibrariesCache(stream, homeLocal)
                  // Register linked streams so client.list() includes them.
                  // Also add placeholder sync entries so pages waiting for a
                  // linked library see it as "syncing" rather than "not found".
                  const linkedLibraries = await getLinkedLibraries(stream)
                  for (const col of linkedLibraries) {
                    if (col.linked_stream_key) {
                      try {
                        await client.addWriteKey('scribe', col.linked_stream_key)
                        // Mark as syncing so UI components know this library exists
                        if (col.linked_stream_id && !latestPerStream[col.linked_stream_id]) {
                          latestPerStream[col.linked_stream_id] = {
                            synced: false,
                            isSyncing: true,
                            currentIndex: 0,
                            finalIndex: 0,
                            lastSyncedAt: null,
                            hasError: false,
                            lastEdited: null,
                            libraryTitle: col.title || null,
                          }
                        }
                      } catch (err) {
                        console.error(`[sync] Error registering linked library ${col.linked_stream_id}:`, err)
                      }
                    }
                  }
                  pushStatus()
                } catch (err) {
                  console.error('[sync] Error seeding linked libraries cache:', err)
                }
              }

              // Cache metadata for non-home libraries on the home stream's local DB
              if (id !== homeStreamId && homeLocal && libraryTitle != null) {
                const status = latestPerStream[id]
                try {
                  await upsertLinkedLibrary(homeLocal, {
                    stream_id: id,
                    title: libraryTitle,
                    last_edited: lastEdited,
                    sync_current_index: status?.currentIndex ?? 0,
                    sync_final_index: status?.finalIndex ?? 0,
                    last_synced_at: status?.lastSyncedAt?.toISOString() ?? null,
                  })
                } catch (err) {
                  console.error('[sync] Error caching linked library metadata:', err)
                }
              }
            } catch (error) {
              console.error('Error reindexing library:', error)
            }
          }
        }

        // Prefetch the next batch for streams that are still syncing,
        // so the network request runs in parallel with the sleep/wait.
        for (const { id, stream } of streamsToSync) {
          const s = latestPerStream[id]
          if (s && !s.synced && !s.hasError) {
            stream.prefetch(10)
          }
        }

        const allComplete = pushStatus()
        hasRunOnce = true
        isRunning = false
        if (pendingWakeUp) {
          pendingWakeUp = false
          scheduleNext(0)
        } else {
          const delay = nextDelay(allComplete)
          // Halve the wait when the synced library had no changes,
          // so we cycle through the round-robin faster when idle
          const adjustedDelay = hadChanges ? delay : Math.max(Math.floor(delay / 2), 10)
          scheduleNext(adjustedDelay)
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
          const errorDelay = document.hidden ? pollInterval * 30 : pollInterval * 5
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
  lastEdited: null,
  libraryTitle: null,
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
