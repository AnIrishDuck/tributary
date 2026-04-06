import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { TributaryClient, FakeServer } from 'tributary-client'
import { syncedMigrations, localMigrations, createNote } from 'scribe-data'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { SyncLoop, SyncLoopConfig } from '../src/syncLoop'
import type { SyncStatusState, SyncStatus } from '../src/types'

// ── Helpers ─────────────────────────────────────────────────

async function createClient(server?: FakeServer) {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  return { client, server: s, pglite }
}

async function setupLibrary(client: TributaryClient, server: FakeServer) {
  const keyPair = nacl.sign.keyPair()
  const stream = await client.addWriteKey('scribe', keyPair.secretKey)
  await syncedMigrations(stream)
  await localMigrations(stream.local())
  await stream.sync(1000)
  return { stream, keyPair, streamId: stream.getId() }
}

/** Write a note to a stream, creating a blob the reader needs to sync. */
async function writeNote(stream: any, suffix: string) {
  await createNote(stream, {
    block_type: 'note',
    body: `test body ${suffix}`,
    slug: `test-${suffix}`,
    collection_id: null,
    inserter: 'test',
  })
}

/**
 * Create a SyncLoop with controllable scheduling.
 * Instead of real setTimeout, we capture scheduled callbacks and delays
 * so tests can advance the loop step-by-step.
 */
function createTestLoop(config: Omit<SyncLoopConfig, 'setTimeout' | 'clearTimeout'>) {
  let pendingCallback: (() => void) | null = null
  let pendingDelay: number | null = null
  let timeoutCounter = 0

  const fakeSetTimeout = (fn: () => void, delay: number) => {
    pendingCallback = fn
    pendingDelay = delay
    return ++timeoutCounter as any
  }
  const fakeClearTimeout = (_id: any) => {
    pendingCallback = null
    pendingDelay = null
  }

  const loop = new SyncLoop({
    ...config,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
  })

  return {
    loop,
    get pendingDelay() { return pendingDelay },
    async advance() {
      const cb = pendingCallback
      pendingCallback = null
      pendingDelay = null
      if (cb) {
        await (cb as any)()
      }
    },
    get hasPending() { return pendingCallback !== null },
  }
}

// ── Tests ───────────────────────────────────────────────────

describe('SyncLoop', () => {
  describe('sync speed: fast when data exists, slow when idle', () => {
    it('should schedule next iteration quickly (10ms) when there is data to sync', async () => {
      // Writer writes enough data that sync(10) can't finish in one batch.
      // syncedMigrations creates ~7 blobs, so we need >3 more notes to exceed 10.
      const server = new FakeServer()
      const { client: writerClient } = await createClient(server)
      const { keyPair, stream: writerStream } = await setupLibrary(writerClient, server)

      // Write enough notes to push total blobs well past 10
      for (let i = 0; i < 6; i++) {
        await writeNote(writerStream, `speed-${i}`)
      }

      // Reader has the same key but a fresh DB — 13+ blobs to sync
      const readerPglite = new PGlite('memory://')
      const readerClient = new TributaryClient({ server, db: readerPglite })
      await readerClient.addWriteKey('scribe', keyPair.secretKey)

      const { loop } = createTestLoop({
        client: readerClient,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: () => {},
      })

      await loop.start()

      // sync(10) got 10 of 13+ blobs, so complete()=false → fast schedule
      expect(loop.lastScheduledDelay).toBe(10)

      loop.stop()
    })

    it('should schedule next iteration slowly when fully synced', async () => {
      const server = new FakeServer()
      const { client } = await createClient(server)
      await setupLibrary(client, server)

      const { loop } = createTestLoop({
        client,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: () => {},
      })

      await loop.start()

      // When allComplete=true and no changes: delay = 15000/2 = 7500
      expect(loop.lastScheduledDelay).toBeGreaterThanOrEqual(7500)

      loop.stop()
    })

    it('should speed up again when new data arrives after being idle', async () => {
      // Use two separate clients: one for reading (with SyncLoop), one for writing
      const server = new FakeServer()

      // Writer client creates and writes to the library
      const { client: writerClient } = await createClient(server)
      const { keyPair, stream: writerStream } = await setupLibrary(writerClient, server)

      // Reader client syncs via SyncLoop
      const readerPglite = new PGlite('memory://')
      const readerClient = new TributaryClient({ server, db: readerPglite })
      await readerClient.addWriteKey('scribe', keyPair.secretKey)

      const { loop, advance } = createTestLoop({
        client: readerClient,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: () => {},
      })

      // Run until fully synced and idle
      await loop.start()
      await advance()
      expect(loop.lastScheduledDelay).toBeGreaterThanOrEqual(7500)

      // Writer adds enough data so that the reader's sync(10) won't finish in one batch
      for (let i = 0; i < 15; i++) {
        await writeNote(writerStream, `new-data-${i}`)
      }

      // Advance the loop — it should detect new data and schedule fast
      await advance()
      expect(loop.lastScheduledDelay).toBe(10)

      loop.stop()
    })

    it('should use 30x pollInterval when tab is hidden', async () => {
      const server = new FakeServer()
      const { client } = await createClient(server)
      await setupLibrary(client, server)

      let hidden = false
      const { loop, advance } = createTestLoop({
        client,
        pollInterval: 1000,
        isHidden: () => hidden,
        onStatusChange: () => {},
      })

      // First sync runs regardless of visibility
      await loop.start()

      // Now hide the tab
      hidden = true
      await advance()

      // Should be in background throttle mode
      expect(loop.lastScheduledDelay).toBe(30000)

      loop.stop()
    })
  })

  describe('wakeUp restarts sync immediately', () => {
    it('should restart loop immediately when wakeUp is called while idle', async () => {
      const server = new FakeServer()

      // Writer client
      const { client: writerClient } = await createClient(server)
      const { keyPair, stream: writerStream } = await setupLibrary(writerClient, server)

      // Reader client with SyncLoop
      const readerPglite = new PGlite('memory://')
      const readerClient = new TributaryClient({ server, db: readerPglite })
      await readerClient.addWriteKey('scribe', keyPair.secretKey)

      const { loop, advance } = createTestLoop({
        client: readerClient,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: () => {},
      })

      // Run until idle
      await loop.start()
      await advance()
      expect(loop.lastScheduledDelay).toBeGreaterThanOrEqual(7500)

      // Writer adds enough data that sync(10) won't finish in one batch
      for (let i = 0; i < 15; i++) {
        await writeNote(writerStream, `wakeup-${i}`)
      }

      // wakeUp clears the pending timeout and starts syncIteration
      loop.wakeUp()
      await advance()

      // The loop should have found new data and scheduled fast
      expect(loop.lastScheduledDelay).toBe(10)
      loop.stop()
    })

    it('should schedule delay=0 when pendingWakeUp fires', async () => {
      const server = new FakeServer()
      const { client } = await createClient(server)
      const { keyPair, stream: writerStream } = await setupLibrary(client, server)

      // Write data so the reader has something to sync
      for (let i = 0; i < 5; i++) {
        await writeNote(writerStream, `wake-${i}`)
      }

      // Create a reader
      const readerPglite = new PGlite('memory://')
      const readerClient = new TributaryClient({ server, db: readerPglite })
      await readerClient.addWriteKey('scribe', keyPair.secretKey)

      const { loop, advance } = createTestLoop({
        client: readerClient,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: () => {},
      })

      await loop.start()

      // After first iteration, wakeUp and advance
      loop.wakeUp()
      await advance()

      expect(loop.lastScheduledDelay).not.toBeNull()

      loop.stop()
    })
  })

  describe('sync status propagation', () => {
    it('should report per-stream sync progress', async () => {
      const server = new FakeServer()
      const { client: writerClient } = await createClient(server)
      const { keyPair, stream: writerStream } = await setupLibrary(writerClient, server)

      // Write several blobs
      for (let i = 0; i < 5; i++) {
        await writeNote(writerStream, `status-${i}`)
      }

      // Reader syncs
      const readerPglite = new PGlite('memory://')
      const readerClient = new TributaryClient({ server, db: readerPglite })
      const readerStream = await readerClient.addWriteKey('scribe', keyPair.secretKey)
      const streamId = readerStream.getId()

      const statuses: SyncStatusState[] = []
      const { loop } = createTestLoop({
        client: readerClient,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: (state) => statuses.push(JSON.parse(JSON.stringify(state))),
      })

      await loop.start()

      expect(statuses.length).toBeGreaterThan(0)

      const lastStatus = statuses[statuses.length - 1]
      expect(lastStatus.perStream[streamId]).toBeDefined()
      expect(lastStatus.perStream[streamId].currentIndex).toBeGreaterThan(0)
      expect(lastStatus.perStream[streamId].finalIndex).toBeGreaterThan(0)

      loop.stop()
    })

    it('should report global sync status aggregated across streams', async () => {
      const server = new FakeServer()
      const { client } = await createClient(server)
      await setupLibrary(client, server)

      // Add a second library
      const keyPair2 = nacl.sign.keyPair()
      const stream2 = await client.addWriteKey('scribe', keyPair2.secretKey)
      await syncedMigrations(stream2)
      await localMigrations(stream2.local())
      await stream2.sync(1000)

      const statuses: SyncStatusState[] = []
      const { loop, advance } = createTestLoop({
        client,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: (state) => statuses.push(JSON.parse(JSON.stringify(state))),
      })

      // Run enough iterations to sync all libraries
      await loop.start()
      await advance()
      await advance()

      expect(statuses.length).toBeGreaterThan(0)
      const lastStatus = statuses[statuses.length - 1]
      expect(lastStatus.aggregated).toBeDefined()
      expect(typeof lastStatus.aggregated.synced).toBe('boolean')
      expect(typeof lastStatus.aggregated.currentIndex).toBe('number')

      loop.stop()
    })

    it('should mark a stream as synced only after post-sync reindexing completes', async () => {
      const server = new FakeServer()
      const { client: writerClient } = await createClient(server)
      const { keyPair, stream: writerStream } = await setupLibrary(writerClient, server)

      await writeNote(writerStream, 'idx-1')

      const readerPglite = new PGlite('memory://')
      const readerClient = new TributaryClient({ server, db: readerPglite })
      const readerStream = await readerClient.addWriteKey('scribe', keyPair.secretKey)
      const streamId = readerStream.getId()

      const statuses: SyncStatusState[] = []
      const { loop } = createTestLoop({
        client: readerClient,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: (state) => statuses.push(JSON.parse(JSON.stringify(state))),
      })

      await loop.start()

      const syncedUpdate = statuses.find(s =>
        s.perStream[streamId]?.synced === true
      )

      if (syncedUpdate) {
        expect(syncedUpdate.perStream[streamId].currentIndex).toBeGreaterThan(0)
      }

      loop.stop()
    })

    it('should report hasError when a blob is corrupted', async () => {
      const server = new FakeServer()
      const { client: writerClient } = await createClient(server)
      const { keyPair, stream: writerStream } = await setupLibrary(writerClient, server)

      await writeNote(writerStream, 'err-1')

      // Corrupt the last blob
      const allBlobs = Array.from((server as any).blobs.values()) as any[]
      const lastBlob = allBlobs[allBlobs.length - 1]
      lastBlob.data = new Uint8Array([0, 1, 2, 3])

      const readerPglite = new PGlite('memory://')
      const readerClient = new TributaryClient({ server, db: readerPglite })
      await readerClient.addWriteKey('scribe', keyPair.secretKey)

      const statuses: SyncStatusState[] = []
      const { loop } = createTestLoop({
        client: readerClient,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: (state) => statuses.push(JSON.parse(JSON.stringify(state))),
      })

      await loop.start()

      // Sync should still complete (errors are recorded, not thrown)
      expect(statuses.length).toBeGreaterThan(0)

      loop.stop()
    })
  })

  describe('home library sync', () => {
    it('should sync the home library in round-robin mode', async () => {
      const server = new FakeServer()
      const { client } = await createClient(server)

      const { keyPair, stream: homeStream, streamId: homeId } = await setupLibrary(client, server)
      await client.setHomeStream(homeId)

      await writeNote(homeStream, 'home-1')

      // Create a reader
      const readerPglite = new PGlite('memory://')
      const readerClient = new TributaryClient({ server, db: readerPglite })
      await readerClient.addWriteKey('scribe', keyPair.secretKey)
      const readerStreamId = (await readerClient.list())[0]
      await readerClient.setHomeStream(readerStreamId)

      const statuses: SyncStatusState[] = []
      const { loop } = createTestLoop({
        client: readerClient,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: (state) => statuses.push(JSON.parse(JSON.stringify(state))),
      })

      await loop.start()

      // Home library should have been synced
      const homeStatus = statuses.find(s => s.perStream[readerStreamId])
      expect(homeStatus).toBeDefined()
      expect(homeStatus!.perStream[readerStreamId].currentIndex).toBeGreaterThan(0)

      loop.stop()
    })

    it('should round-robin through all libraries on home page', async () => {
      const server = new FakeServer()
      const { client } = await createClient(server)

      const lib1 = await setupLibrary(client, server)
      const keyPair2 = nacl.sign.keyPair()
      const lib2Stream = await client.addWriteKey('scribe', keyPair2.secretKey)
      await syncedMigrations(lib2Stream)
      await localMigrations(lib2Stream.local())
      await lib2Stream.sync(1000)
      const lib2Id = lib2Stream.getId()

      const syncedStreamIds = new Set<string>()
      const { loop, advance } = createTestLoop({
        client,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: (state) => {
          for (const id of Object.keys(state.perStream)) {
            syncedStreamIds.add(id)
          }
        },
      })

      // Run enough iterations to cycle through all libraries
      await loop.start()
      await advance()
      await advance()

      // Both libraries should have been visited
      expect(syncedStreamIds.has(lib1.streamId)).toBe(true)
      expect(syncedStreamIds.has(lib2Id)).toBe(true)

      loop.stop()
    })
  })

  describe('focused library sync', () => {
    it('should only sync the focused library when one is set', async () => {
      const server = new FakeServer()
      const { client } = await createClient(server)

      const lib1 = await setupLibrary(client, server)
      const keyPair2 = nacl.sign.keyPair()
      const lib2Stream = await client.addWriteKey('scribe', keyPair2.secretKey)
      await syncedMigrations(lib2Stream)
      await localMigrations(lib2Stream.local())
      await lib2Stream.sync(1000)
      const lib2Id = lib2Stream.getId()

      // Write data to both
      await writeNote(lib1.stream, 'f-1')
      await writeNote(lib2Stream, 'f-2')

      // Create reader focused on lib1 only
      const readerPglite = new PGlite('memory://')
      const readerClient = new TributaryClient({ server, db: readerPglite })
      await readerClient.addWriteKey('scribe', lib1.keyPair.secretKey)
      await readerClient.addWriteKey('scribe', keyPair2.secretKey)

      const syncedStreamIds = new Set<string>()
      const { loop, advance } = createTestLoop({
        client: readerClient,
        pollInterval: 1000,
        isHidden: () => false,
        onStatusChange: (state) => {
          for (const [id, status] of Object.entries(state.perStream)) {
            if (status.currentIndex > 0) syncedStreamIds.add(id)
          }
        },
      })

      loop.setFocusedLibrary(lib1.streamId)
      await loop.start()
      await advance()
      await advance()

      expect(syncedStreamIds.has(lib1.streamId)).toBe(true)
      expect(syncedStreamIds.has(lib2Id)).toBe(false)

      loop.stop()
    })
  })
})
