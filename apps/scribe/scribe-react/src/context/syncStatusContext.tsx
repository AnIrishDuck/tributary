import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { TributaryClient, TributaryStream, SyncStatus as TributarySyncStatus } from 'tributary-client'
import { indexAll, localMigrations, getLastEditedTime, getLibraryDisplayName, upsertLinkedLibrary, seedLinkedLibrariesCache } from 'scribe-data'
import { getSyncStatusChannel, sendSyncControl } from '../db/persistence'
import type { SyncStatusOutMessage, WorkerSyncStatus, StreamCredential } from '../db/sync-worker-messages'
import * as base64url from 'urlsafe-base64'

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

/**
 * Convert a WorkerSyncStatus (ISO string dates) to SyncStatus (Date objects).
 */
function toSyncStatus(ws: WorkerSyncStatus): SyncStatus {
  return {
    synced: ws.synced,
    isSyncing: ws.isSyncing,
    currentIndex: ws.currentIndex,
    finalIndex: ws.finalIndex,
    lastSyncedAt: ws.lastSyncedAt ? new Date(ws.lastSyncedAt) : null,
    hasError: ws.hasError,
    lastEdited: ws.lastEdited,
    libraryTitle: ws.libraryTitle,
  }
}

/**
 * SyncStatusProvider manages background sync and exposes status to the UI.
 *
 * Two modes:
 * - **Worker mode** (default, production): Delegates sync to the PGlite
 *   background worker via BroadcastChannel. The worker has direct, zero-copy
 *   access to PGlite, avoiding the serialization overhead of sending blobs
 *   through postMessage.
 * - **Fallback mode** (`useWorkerSync={false}`, tests): Runs the sync loop
 *   on the main thread, using the PGlite instance directly via PGliteWorker
 *   RPC. Used in tests where no Web Worker is available.
 */
export const SyncStatusProvider: React.FC<{
  client: TributaryClient
  children: ReactNode
  pollInterval?: number
  /**
   * Whether to delegate sync to the background worker (default: true).
   * Set to false in test environments where no Web Worker is available.
   */
  useWorkerSync?: boolean
  /** Server config for the sync worker (required when useWorkerSync=true) */
  apiUrl?: string
  apiKey?: string | undefined
  authToken?: string | undefined
  appId?: string
}> = ({ client, children, pollInterval = 1000, useWorkerSync = true, apiUrl, apiKey, authToken, appId = 'scribe' }) => {
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
  const [focusedLibraryId, setFocusedLibrary] = useState<string | null>(null)
  const focusedLibraryRef = useRef<string | null>(null)

  // Keep ref in sync so the async sync loop can read the latest value
  useEffect(() => {
    focusedLibraryRef.current = focusedLibraryId
  }, [focusedLibraryId])

  // ── Worker mode: delegate to background worker ─────────────────────

  // Send focus changes to the worker
  useEffect(() => {
    if (!useWorkerSync) return
    sendSyncControl({ type: 'set-focus', libraryId: focusedLibraryId })
  }, [focusedLibraryId, useWorkerSync])

  // Track tab visibility and forward to the worker
  const visibleRef = useRef(!document.hidden)
  const wakeUpRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    const onVisibilityChange = () => {
      const wasVisible = visibleRef.current
      visibleRef.current = !document.hidden
      console.log(`[sync] visibilitychange: ${wasVisible ? 'visible' : 'hidden'} → ${document.hidden ? 'hidden' : 'visible'}`)
      if (!document.hidden) {
        if (useWorkerSync) {
          sendSyncControl({ type: 'set-visibility', visible: true })
          sendSyncControl({ type: 'wake-up' })
        } else if (wakeUpRef.current) {
          wakeUpRef.current()
        }
      } else if (useWorkerSync) {
        sendSyncControl({ type: 'set-visibility', visible: false })
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [useWorkerSync])

  // Listen for status updates from the sync worker
  useEffect(() => {
    if (!useWorkerSync) return
    const channel = getSyncStatusChannel()
    const handler = (event: MessageEvent<SyncStatusOutMessage>) => {
      const msg = event.data
      if (msg.type === 'sync-status') {
        const converted: Record<string, SyncStatus> = {}
        for (const [id, ws] of Object.entries(msg.statuses)) {
          converted[id] = toSyncStatus(ws)
        }
        setSyncStatus(converted)
        setGlobalSyncStatus(toSyncStatus(msg.global))
      }
    }
    channel.onmessage = handler
    return () => {
      channel.onmessage = null
    }
  }, [useWorkerSync])

  // Forward auth token changes to the worker
  const prevAuthToken = useRef(authToken)
  useEffect(() => {
    if (!useWorkerSync) return
    if (authToken !== prevAuthToken.current) {
      prevAuthToken.current = authToken
      sendSyncControl({ type: 'update-auth-token', authToken })
    }
  }, [authToken, useWorkerSync])

  // Gather stream credentials and send configure message to the worker
  useEffect(() => {
    if (!useWorkerSync || !apiUrl) return
    let cancelled = false

    async function configure() {
      try {
        const streamIds = await client.list()
        const credentials: StreamCredential[] = []

        for (const streamId of streamIds) {
          const writeKey = await client.getWriteKey(streamId)
          if (writeKey) {
            const privateKey = new Uint8Array(base64url.decode(writeKey))
            const stream = await client.get(appId, streamId)
            if (!stream) continue

            const schemaName = stream.getSchemaName().replace(/^"|"$/g, '')
            const schemaId = schemaName.startsWith(`${appId}_`)
              ? schemaName.slice(appId.length + 1)
              : schemaName

            credentials.push({ streamId, privateKey, schemaId })
          }
        }

        if (cancelled) return

        // If there are no streams, mark sync as complete immediately
        if (credentials.length === 0) {
          setGlobalSyncStatus({
            synced: true,
            isSyncing: false,
            currentIndex: 0,
            finalIndex: 0,
            lastSyncedAt: new Date(),
            hasError: false,
            lastEdited: null,
            libraryTitle: null,
          })
        }

        sendSyncControl({
          type: 'configure',
          apiUrl: apiUrl!,
          apiKey,
          authToken,
          streams: credentials,
          appId,
        })
      } catch (err) {
        console.error('[SyncStatusProvider] Failed to configure sync worker:', err)
      }
    }

    configure()
    return () => { cancelled = true }
  }, [client, apiUrl, apiKey, appId, useWorkerSync])

  // ── Fallback mode: main-thread sync loop (for tests) ──────────────

  useEffect(() => {
    if (useWorkerSync) return

    let timeoutId: ReturnType<typeof setTimeout>
    let isMounted = true
    let isRunning = false
    let pendingWakeUp = false
    let hasRunOnce = false
    let roundRobinIndex = 0

    visibleRef.current = !document.hidden

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

    const nextDelay = (allComplete: boolean) => {
      if (document.hidden) return pollInterval * 30
      return allComplete ? pollInterval : 10
    }

    const syncLoop = async () => {
      if (!isMounted) return

      if (hasRunOnce && document.hidden) {
        visibleRef.current = false
        scheduleNext(pollInterval * 30)
        return
      }
      visibleRef.current = !document.hidden

      if (isRunning) return
      isRunning = true
      pendingWakeUp = false

      setGlobalSyncStatus(prev => ({ ...prev, isSyncing: true, hasError: false }))

      try {
        const streamIds = await client.list()
        const streams: Array<{ id: string, stream: TributaryStream }> = []
        for (const streamId of streamIds) {
          const stream = await client.get('scribe', streamId)
          if (stream) streams.push({ id: streamId, stream })
        }

        if (!isMounted) { isRunning = false; return }

        const focused = focusedLibraryRef.current
        const syncFocus: SyncFocus = focused
          ? { type: 'library', id: focused }
          : { type: 'home' }

        const homeStreamId = await client.getHomeStream()

        let streamsToSync: Array<{ id: string; stream: TributaryStream }>
        if (syncFocus.type === 'library') {
          streamsToSync = streams.filter(s => s.id === syncFocus.id)
        } else {
          if (streams.length > 0) {
            const index = roundRobinIndex % streams.length
            streamsToSync = [streams[index]]
            roundRobinIndex = (index + 1) % streams.length
          } else {
            streamsToSync = []
          }
        }

        let hadChanges = false
        for (const { id, stream } of streamsToSync) {
          if (!isMounted) { isRunning = false; return }

          try {
            const prevStatus = latestPerStream[id]
            const tributaryStatus = await stream.sync(10)
            const isComplete = tributaryStatus.complete()

            if (!prevStatus ||
                prevStatus.currentIndex !== tributaryStatus.currentIndex ||
                prevStatus.finalIndex !== tributaryStatus.finalIndex) {
              hadChanges = true
            }

            latestPerStream[id] = {
              ...latestPerStream[id],
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
            hadChanges = true
          }
          pushStatus()
        }

        if (!isMounted) { isRunning = false; return }

        if (hadChanges) {
          let homeLocal: Awaited<ReturnType<TributaryStream['local']>> | null = null
          if (homeStreamId) {
            const homeEntry = streams.find(s => s.id === homeStreamId)
            if (homeEntry) homeLocal = homeEntry.stream.local()
          }

          for (const { id, stream } of streamsToSync) {
            if (!isMounted) { isRunning = false; return }
            try {
              await localMigrations(stream.local())
              await indexAll(stream.local())

              const lastEdited = await getLastEditedTime(stream.local())
              const libraryTitle = await getLibraryDisplayName(stream)

              latestPerStream[id] = {
                ...latestPerStream[id],
                lastEdited,
                libraryTitle,
              }

              if (id === homeStreamId && homeLocal) {
                try {
                  await seedLinkedLibrariesCache(stream, homeLocal)
                } catch (err) {
                  console.error('[sync] Error seeding linked libraries cache:', err)
                }
              }

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

        const allComplete = pushStatus()
        hasRunOnce = true
        isRunning = false
        if (pendingWakeUp) {
          pendingWakeUp = false
          scheduleNext(0)
        } else {
          const delay = nextDelay(allComplete)
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
          const errorDelay = document.hidden ? pollInterval * 30 : pollInterval * 5
          scheduleNext(errorDelay)
        }
      }
    }

    wakeUpRef.current = () => {
      clearTimeout(timeoutId)
      if (isRunning) {
        pendingWakeUp = true
      } else {
        syncLoop()
      }
    }

    syncLoop()

    return () => {
      isMounted = false
      wakeUpRef.current = null
      clearTimeout(timeoutId)
    }
  }, [client, pollInterval, useWorkerSync])

  // ── Manual sync functions ──────────────────────────────────────────

  const syncStream = useCallback(async (streamId: string, max: number = 10) => {
    if (useWorkerSync) {
      sendSyncControl({ type: 'sync-now', streamId })
    } else {
      const stream = await client.get('scribe', streamId)
      if (stream) {
        await stream.sync(max)
      }
    }
  }, [client, useWorkerSync])

  const syncAll = useCallback(async (max: number = 10) => {
    if (useWorkerSync) {
      sendSyncControl({ type: 'sync-now' })
    } else {
      await client.sync(max)
    }
  }, [client, useWorkerSync])

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
