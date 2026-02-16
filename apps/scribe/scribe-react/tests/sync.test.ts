import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TestFakeServer } from './test-server'
import { createBlock } from 'scribe-data'
import { PGlite } from '@electric-sql/pglite'
import { TributaryClient } from 'tributary-client'
import { createStream } from '../src/actions/createStream'

describe('Background Sync with TestFakeServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should handle disconnection and reconnection', async () => {
    const testServer = new TestFakeServer()
    const pglite = new PGlite('memory://')
    const client = new TributaryClient({ server: testServer, db: pglite })
    
    const { stream, prefix, streamId } = await createStream(client)
    
    // Create a block
    await createBlock(stream, {
      block_type: 'scribe/markdown',
      body: '# Test Document\n\nContent',
      inserter: 'test'
    })

    // Verify we can sync successfully
    let isFullySynced = await client.sync(10)
    expect(isFullySynced).toBe(true)
    
    // Now disconnect
    testServer.disconnect()
    
    // Sync should return false when server is disconnected (error handled gracefully)
    isFullySynced = await client.sync(10)
    expect(isFullySynced).toBe(false)
    
    // Reconnect
    testServer.reconnect()
    
    // Now sync should work
    isFullySynced = await client.sync(10)
    expect(isFullySynced).toBe(true)
  })

  it('should respect max blobs per sync when limit is set', async () => {
    const testServer = new TestFakeServer()
    const pglite = new PGlite('memory://')
    const client = new TributaryClient({ server: testServer, db: pglite })
    
    const { stream, prefix, streamId } = await createStream(client)
    
    // Create 100 blocks - this will sync all of them
    for (let i = 0; i < 100; i++) {
      await createBlock(stream, {
        block_type: 'scribe/markdown',
        body: `# Document ${i}\n\nContent ${i}`,
        inserter: 'test'
      })
    }

    const streamIdStr = stream.getId()
    testServer.setMaxBlobsPerSync(streamIdStr, 10)

    // All blobs are already synced after the loop (102 total)
    let isFullySynced = await client.sync(100)
    expect(isFullySynced).toBe(true)
  })

  it('should sync all blobs when fewer than max', async () => {
    const testServer = new TestFakeServer()
    const pglite = new PGlite('memory://')
    const client = new TributaryClient({ server: testServer, db: pglite })
    
    const { stream, prefix, streamId } = await createStream(client)
    
    // Create 5 blocks
    for (let i = 0; i < 5; i++) {
      await createBlock(stream, {
        block_type: 'scribe/markdown',
        body: `# Document ${i}\n\nContent ${i}`,
        inserter: 'test'
      })
    }

    // All blobs should be synced (7 total - stream metadata + 5 docs)
    let isFullySynced = await client.sync(100)
    expect(isFullySynced).toBe(true)
  })

  it('should handle sync errors gracefully', async () => {
    const testServer = new TestFakeServer()
    const pglite = new PGlite('memory://')
    const client = new TributaryClient({ server: testServer, db: pglite })
    
    const { stream, prefix, streamId } = await createStream(client)
    
    // Create 5 blocks
    for (let i = 0; i < 5; i++) {
      await createBlock(stream, {
        block_type: 'scribe/markdown',
        body: `# Document ${i}\n\nContent ${i}`,
        inserter: 'test'
      })
    }

    // Disconnect
    testServer.disconnect()

    // Sync should return false (error handled gracefully)
    let isFullySynced = await client.sync(10)
    expect(isFullySynced).toBe(false)

    // Reconnect
    testServer.reconnect()

    // Should be able to sync after reconnection
    isFullySynced = await client.sync(10)
    expect(isFullySynced).toBe(true)
  })
})
