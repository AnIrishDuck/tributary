import { PGlite, PGliteInterface } from '@electric-sql/pglite'
import { worker } from '@electric-sql/pglite/worker'
import { TributaryClient, TributaryStream, TributaryServer } from 'tributary-client'
import { indexAll, localMigrations, getLastEditedTime, getLibraryDisplayName, upsertLinkedLibrary, seedLinkedLibrariesCache } from 'scribe-data'
import type {
  SyncControlMessage,
  WorkerSyncStatus,
} from './sync-worker-messages'
import {
  SYNC_CONTROL_CHANNEL,
  SYNC_STATUS_CHANNEL,
} from './sync-worker-messages'

// ── Sync engine state ────────────────────────────────────────────────

let db: PGliteInterface | null = null
let server: TributaryServer | null = null
let client: TributaryClient | null = null
let appId = 'scribe'

let focusedLibraryId: string | null = null
let visible = true
let configured = false

// Sync loop scheduling
let syncTimeout: ReturnType<typeof setTimeout> | null = null
let isRunning = false
let pendingWakeUp = false
let hasRunOnce = false
let roundRobinIndex = 0

const POLL_INTERVAL = 1000

// Per-stream status
let latestPerStream: Record<string, WorkerSyncStatus> = {}

// Channels (created once in init)
let statusChannel: BroadcastChannel | null = null

// ── Helpers ──────────────────────────────────────────────────────────

function pushStatus() {
  if (!statusChannel) return

  const snapshot = { ...latestPerStream }
  const statuses = Object.values(snapshot)
  const allComplete = statuses.length === 0 || statuses.every(s => s.synced)
  const anyError = statuses.some(s => s.hasError)
  const totalCurrent = statuses.reduce((sum, s) => sum + s.currentIndex, 0)
  const totalFinal = statuses.reduce((sum, s) => sum + s.finalIndex, 0)

  statusChannel.postMessage({
    type: 'sync-status',
    statuses: snapshot,
    global: {
      synced: allComplete,
      isSyncing: !allComplete,
      currentIndex: totalCurrent,
      finalIndex: totalFinal,
      lastSyncedAt: allComplete ? new Date().toISOString() : null,
      hasError: anyError,
      lastEdited: null,
      libraryTitle: null,
    },
  })

  return allComplete
}

function nextDelay(allComplete: boolean): number {
  if (!visible) return POLL_INTERVAL * 30
  return allComplete ? POLL_INTERVAL : 10
}

function scheduleNext(delay: number) {
  if (syncTimeout !== null) clearTimeout(syncTimeout)
  syncTimeout = setTimeout(syncLoop, delay)
}

function defaultStatus(): WorkerSyncStatus {
  return {
    synced: false,
    isSyncing: false,
    currentIndex: 0,
    finalIndex: 0,
    lastSyncedAt: null,
    hasError: false,
    lastEdited: null,
    libraryTitle: null,
  }
}

// ── Sync loop ────────────────────────────────────────────────────────

async function syncLoop() {
  if (!configured || !client || !db) {
    console.log('[sync-worker] not configured, skipping')
    return
  }

  // Always run the first sync regardless of tab visibility (browsers can fire
  // a spurious visibilitychange during page load).
  if (hasRunOnce && !visible) {
    console.log(`[sync-worker] tab hidden, sleeping for ${POLL_INTERVAL * 30}ms`)
    scheduleNext(POLL_INTERVAL * 30)
    return
  }

  if (isRunning) {
    console.log('[sync-worker] already running, skipping')
    return
  }
  isRunning = true
  pendingWakeUp = false

  try {
    // Load all libraries
    const streamIds = await client.list()
    const streams: Array<{ id: string; stream: TributaryStream }> = []
    for (const streamId of streamIds) {
      const stream = await client.get(appId, streamId)
      if (stream) streams.push({ id: streamId, stream })
    }

    // Determine focus
    const homeStreamId = await client.getHomeStream()

    let streamsToSync: Array<{ id: string; stream: TributaryStream }>
    if (focusedLibraryId) {
      streamsToSync = streams.filter(s => s.id === focusedLibraryId)
      console.log(`[sync-worker] focus: library ${focusedLibraryId}`)
    } else {
      if (streams.length > 0) {
        const index = roundRobinIndex % streams.length
        streamsToSync = [streams[index]]
        const isHome = streams[index].id === homeStreamId
        const label = isHome ? '*home* library' : 'library'
        console.log(`[sync-worker] focus: Home, round-robin ${index + 1}/${streams.length}, syncing ${label} ${streams[index].id}`)
        roundRobinIndex = (index + 1) % streams.length
      } else {
        streamsToSync = []
        console.log('[sync-worker] no libraries to sync')
      }
    }

    // Sync the selected library
    let hadChanges = false
    for (const { id, stream } of streamsToSync) {
      try {
        const prevStatus = latestPerStream[id]
        const tributaryStatus = await stream.sync(10)
        const isComplete = tributaryStatus.complete()

        if (
          !prevStatus ||
          prevStatus.currentIndex !== tributaryStatus.currentIndex ||
          prevStatus.finalIndex !== tributaryStatus.finalIndex
        ) {
          hadChanges = true
        }

        latestPerStream[id] = {
          ...(latestPerStream[id] || defaultStatus()),
          synced: isComplete,
          isSyncing: !isComplete,
          currentIndex: tributaryStatus.currentIndex,
          finalIndex: tributaryStatus.finalIndex,
          lastSyncedAt: isComplete ? new Date().toISOString() : null,
          hasError: !!tributaryStatus.error,
        }
      } catch (err) {
        console.error(`[sync-worker] Error syncing library ${id}:`, err)
        latestPerStream[id] = {
          ...(latestPerStream[id] || defaultStatus()),
          isSyncing: false,
          hasError: true,
        }
        hadChanges = true
      }
      pushStatus()
    }

    // Reindex if data changed
    if (hadChanges) {
      // Resolve the home stream's local DB once for caching linked library metadata
      let homeLocal: Awaited<ReturnType<TributaryStream['local']>> | null = null
      if (homeStreamId) {
        const homeEntry = streams.find(s => s.id === homeStreamId)
        if (homeEntry) homeLocal = homeEntry.stream.local()
      }

      for (const { id, stream } of streamsToSync) {
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

          // When the home stream finishes syncing, seed the linked_libraries
          // cache so the home page renders immediately on next load.
          if (id === homeStreamId && homeLocal) {
            try {
              await seedLinkedLibrariesCache(stream, homeLocal)
            } catch (err) {
              console.error('[sync-worker] Error seeding linked libraries cache:', err)
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
                last_synced_at: status?.lastSyncedAt ?? null,
              })
            } catch (err) {
              console.error('[sync-worker] Error caching linked library metadata:', err)
            }
          }
        } catch (error) {
          console.error('[sync-worker] Error reindexing library:', error)
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
      const delay = nextDelay(allComplete ?? false)
      const adjustedDelay = hadChanges ? delay : Math.max(Math.floor(delay / 2), 10)
      scheduleNext(adjustedDelay)
    }
  } catch (error) {
    console.error('[sync-worker] Background sync error:', error)
    isRunning = false
    if (pendingWakeUp) {
      pendingWakeUp = false
      scheduleNext(0)
    } else {
      const errorDelay = !visible ? POLL_INTERVAL * 30 : POLL_INTERVAL * 5
      scheduleNext(errorDelay)
    }
  }
}

// ── Handle control messages ──────────────────────────────────────────

async function handleControl(msg: SyncControlMessage) {
  switch (msg.type) {
    case 'configure': {
      console.log(`[sync-worker] configure: ${msg.streams.length} streams, appId=${msg.appId}`)

      appId = msg.appId

      server = new TributaryServer(msg.apiUrl, msg.apiKey)
      if (msg.authToken) {
        server.setWriteAuthToken(msg.authToken)
      }

      // Create client using the DIRECT PGlite instance (zero-copy!)
      client = new TributaryClient({ server, db: db! })

      // Register all stream credentials
      for (const cred of msg.streams) {
        try {
          await client.addWriteKey(appId, cred.privateKey)
        } catch (err) {
          console.error(`[sync-worker] Failed to register stream ${cred.streamId}:`, err)
        }
      }

      configured = true

      // Start (or restart) the sync loop
      if (syncTimeout !== null) clearTimeout(syncTimeout)
      hasRunOnce = false
      roundRobinIndex = 0
      latestPerStream = {}
      syncLoop()
      break
    }

    case 'set-focus':
      focusedLibraryId = msg.libraryId
      console.log(`[sync-worker] focus changed: ${msg.libraryId ?? 'Home'}`)
      break

    case 'set-visibility':
      visible = msg.visible
      console.log(`[sync-worker] visibility: ${msg.visible ? 'visible' : 'hidden'}`)
      if (msg.visible) {
        if (syncTimeout !== null) clearTimeout(syncTimeout)
        if (isRunning) {
          pendingWakeUp = true
        } else {
          syncLoop()
        }
      }
      break

    case 'wake-up':
      console.log('[sync-worker] wake-up received')
      if (syncTimeout !== null) clearTimeout(syncTimeout)
      if (isRunning) {
        pendingWakeUp = true
      } else {
        syncLoop()
      }
      break

    case 'sync-now':
      console.log(`[sync-worker] sync-now: ${msg.streamId ?? 'all'}`)
      if (msg.streamId) {
        const prevFocus = focusedLibraryId
        focusedLibraryId = msg.streamId
        if (syncTimeout !== null) clearTimeout(syncTimeout)
        if (!isRunning) {
          await syncLoop()
        }
        focusedLibraryId = prevFocus
      } else {
        if (syncTimeout !== null) clearTimeout(syncTimeout)
        if (!isRunning) {
          syncLoop()
        }
      }
      break

    case 'update-auth-token':
      if (server) {
        server.setWriteAuthToken(msg.authToken)
        console.log('[sync-worker] auth token updated')
      }
      break
  }
}

// ── PGlite worker entry point ────────────────────────────────────────

worker({
  async init(options) {
    const pglite = new PGlite({
      dataDir: options.dataDir,
    })
    db = pglite

    // Set up BroadcastChannels for sync communication
    const controlChannel = new BroadcastChannel(SYNC_CONTROL_CHANNEL)
    statusChannel = new BroadcastChannel(SYNC_STATUS_CHANNEL)

    controlChannel.onmessage = (event: MessageEvent<SyncControlMessage>) => {
      handleControl(event.data)
    }

    // Signal readiness
    statusChannel.postMessage({ type: 'sync-ready' })

    console.log('[sync-worker] PGlite initialized, sync engine ready')

    return pglite
  },
})
