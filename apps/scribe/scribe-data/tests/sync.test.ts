import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TestFakeServer } from 'tributary-client'
import { createNote } from '../src/note.js'
import { createHomeLibrary, createLibrary } from '../src/library.js'
import { PGlite } from '@electric-sql/pglite'
import { TributaryClient } from 'tributary-client'
import nacl from 'tweetnacl'

/**
 * Helper to check if all streams in a sync result are fully synced.
 * An empty map (no streams to sync) is considered fully synced.
 */
function allComplete(result: Map<string, any>): boolean {
  if (result.size === 0) return true
  return [...result.values()].every(s => s.complete())
}

async function createTestLibrary(server: TestFakeServer) {
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server, db: pglite })
  const homeKeyPair = nacl.sign.keyPair()
  const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)
  const { stream, prefix, streamId } = await createLibrary(client, 'Test Stream', homeStream)
  return { client, stream, prefix, streamId }
}

describe('Background Sync with TestFakeServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should handle disconnection and reconnection', async () => {
    const testServer = new TestFakeServer()
    const { client, stream } = await createTestLibrary(testServer)

    // Create a note
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Test Document\n\nContent',
      inserter: 'test'
    })

    // Verify we can sync successfully
    let syncResult = await client.sync(10)
    expect(allComplete(syncResult)).toBe(true)

    // Now disconnect
    testServer.disconnect()

    // Sync should not be fully synced when server is disconnected (error handled gracefully)
    syncResult = await client.sync(10)
    expect(allComplete(syncResult)).toBe(false)

    // Reconnect
    testServer.reconnect()

    // Now sync should work
    syncResult = await client.sync(10)
    expect(allComplete(syncResult)).toBe(true)
  })

  it('should respect max blobs per sync when limit is set', async () => {
    const testServer = new TestFakeServer()
    const { client, stream } = await createTestLibrary(testServer)

    // Create 100 notes - this will sync all of them
    for (let i = 0; i < 100; i++) {
      await createNote(stream, {
        block_type: 'scribe/markdown',
        body: `# Document ${i}\n\nContent ${i}`,
        inserter: 'test'
      })
    }

    const streamIdStr = stream.getId()
    testServer.setMaxBlobsPerSync(streamIdStr, 10)

    // All blobs are already synced after the loop (102 total)
    let syncResult = await client.sync(100)
    expect(allComplete(syncResult)).toBe(true)
  })

  it('should sync all blobs when fewer than max', async () => {
    const testServer = new TestFakeServer()
    const { client, stream } = await createTestLibrary(testServer)

    // Create 5 notes
    for (let i = 0; i < 5; i++) {
      await createNote(stream, {
        block_type: 'scribe/markdown',
        body: `# Document ${i}\n\nContent ${i}`,
        inserter: 'test'
      })
    }

    // All blobs should be synced (7 total - stream metadata + 5 docs)
    let syncResult = await client.sync(100)
    expect(allComplete(syncResult)).toBe(true)
  })

  it('should handle sync errors gracefully', async () => {
    const testServer = new TestFakeServer()
    const { client, stream } = await createTestLibrary(testServer)

    // Create 5 notes
    for (let i = 0; i < 5; i++) {
      await createNote(stream, {
        block_type: 'scribe/markdown',
        body: `# Document ${i}\n\nContent ${i}`,
        inserter: 'test'
      })
    }

    // Disconnect
    testServer.disconnect()

    // Sync should not be fully synced (error handled gracefully)
    let syncResult = await client.sync(10)
    expect(allComplete(syncResult)).toBe(false)

    // Reconnect
    testServer.reconnect()

    // Should be able to sync after reconnection
    syncResult = await client.sync(10)
    expect(allComplete(syncResult)).toBe(true)
  })
})
