/**
 * Test to reproduce the bug where migrations don't persist when a stream is loaded
 * from a different client instance.
 * 
 * This simulates:
 * 1. scribe-cli creates a stream and runs migrations
 * 2. scribe-react loads the same stream from the database
 * 3. scribe-react tries to query tables that should exist but don't
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { TributaryClient, createTestServer } from 'tributary-client'
import { up, syncedMigrations, localMigrations } from '../src/migrations'
import { getAllNotesWithTitles } from '../src/indexing'
import nacl from 'tweetnacl'
import { PGlite } from '@electric-sql/pglite'
import { v4 as uuidv4 } from 'uuid'

describe('Migration Persistence Bug', () => {
  let testDb: PGlite
  let privateKey: Uint8Array
  let streamId: string
  let testServer: any

  beforeEach(() => {
    // Create a shared PGlite database that will be used by both clients
    testDb = new PGlite()
    
    // Create a shared test server so both clients talk to the same server
    testServer = createTestServer()
    
    // Generate a keypair for the stream
    const keyPair = nacl.sign.keyPair()
    privateKey = keyPair.secretKey
    
    // Calculate the stream ID (public key in base64url)
    const publicKey = privateKey.slice(32)
    streamId = Buffer.from(publicKey).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  })

  it('should fail when migrations are not in the library (demonstrates current bug)', async () => {
    // Create library WITHOUT running migrations
    const cliClient = new TributaryClient({
      server: createTestServer(),
      db: testDb
    })

    const cliStream = await cliClient.addWriteKey('scribe', privateKey)

    // Without migrations, the block table doesn't exist, so INSERT fails
    await expect(async () => {
      await cliStream.exec(
        `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body, slug)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          uuidv4(),
          'scribe/markdown',
          uuidv4(),
          null,
          new Date().toISOString(),
          'test',
          '# Test Document\n\nThis is a test.',
          'test-document'
        ]
      )
    }).rejects.toThrow(/relation.*block.*does not exist/)
  })

  it('should work with syncedMigrations + localMigrations on a fresh database', async () => {
    // Step 1: Create library in CLI and ensure migrations
    const cliClient = new TributaryClient({
      server: testServer,  // Use shared server
      db: testDb
    })
    
    const cliStream = await cliClient.addWriteKey('scribe', privateKey)
    
    // Run synced + local migrations for a new library
    await syncedMigrations(cliStream)
    await localMigrations(cliStream.local())
    
    // Insert a test block
    const blockUuid = uuidv4()
    const versionUuid = uuidv4()
    await cliStream.exec(
      `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body, slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        blockUuid,
        'scribe/markdown',
        versionUuid,
        null,
        new Date().toISOString(),
        'test',
        '# Test Document\n\nThis is a test.',
        'test-document'
      ]
    )

    // Step 2: Simulate scribe-react loading from a FRESH database
    const freshDb = new PGlite()  // Completely fresh database!
    const reactClient = new TributaryClient({
      server: testServer,  // Use same shared server
      db: freshDb
    })
    
    // Add the library (with the same key)
    const reactStream = await reactClient.addWriteKey('scribe', privateKey)
    expect(reactStream).toBeDefined()
    
    // Sync FIRST to get the library migrations (block table creation)
    await reactStream!.sync(100)
    
    // Then run local migrations only (synced tables arrived via sync)
    await localMigrations(reactStream!.local())
    
    // Get the local database
    const localDb = await reactClient.getLocal('scribe', streamId)
    expect(localDb).toBeDefined()
    
    // This should work because:
    // 1. Block table was created via sync (from library)
    // 2. Local tables were created via localMigrations
    const notes = await getAllNotesWithTitles(localDb!)
    expect(notes).toBeDefined()
    expect(notes.length).toBe(0) // No indexed notes yet (indexing is local-only)
  })

  it('migrations should be idempotent', async () => {
    // Create a library
    const client = new TributaryClient({
      server: createTestServer(),
      db: testDb
    })
    
    const stream = await client.addWriteKey('scribe', privateKey)
    
    // Call migrations multiple times - should not error
    await syncedMigrations(stream)
    await localMigrations(stream.local())
    await localMigrations(stream.local()) // Calling again should also work
    
    // Should still be able to use the library
    const blockUuid = uuidv4()
    const versionUuid = uuidv4()
    await stream.exec(
      `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body, slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        blockUuid,
        'scribe/markdown',
        versionUuid,
        null,
        new Date().toISOString(),
        'test',
        '# Test Document\n\nThis is a test.',
        'test-document'
      ]
    )
    
    // Verify we can query
    const result = await stream.query('SELECT COUNT(*) as count FROM block', [])
    expect(result.rows[0].count).toBe(1)
  })

  it('should create block_search_index table with GIN index', async () => {
    // Create a library and run migrations
    const client = new TributaryClient({
      server: createTestServer(),
      db: testDb
    })
    
    const stream = await client.addWriteKey('scribe', privateKey)
    await syncedMigrations(stream)
    await localMigrations(stream.local())
    
    const localDb = stream.local()
    
    // Verify table exists
    const tableResult = await localDb.query(
      `SELECT table_name FROM information_schema.tables 
       WHERE table_name = 'block_search_index'`,
      []
    )
    expect(tableResult.rows).toHaveLength(1)
    
    // Verify GIN index exists
    const indexResult = await localDb.query(
      `SELECT indexname FROM pg_indexes 
       WHERE tablename = 'block_search_index' 
       AND indexname = 'idx_block_search_vector'`,
      []
    )
    expect(indexResult.rows).toHaveLength(1)
  })
})
