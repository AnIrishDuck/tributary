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
import { up, ensureMigrations } from '../src/migrations'
import { getAllBlocksWithTitles } from '../src/indexing'
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

  it('should fail when migrations are not in the stream (demonstrates current bug)', async () => {
    // Step 1: Create stream in CLI WITHOUT running migrations
    const cliClient = new TributaryClient({
      server: createTestServer(),
      db: testDb
    })
    
    const cliStream = await cliClient.addWriteKey('scribe', privateKey)
    
    // DON'T run migrations - tables only exist in schema, not in stream
    // await up(cliStream, cliStream.local())
    
    // Insert a test block directly (this goes into the stream)
    const blockUuid = uuidv4()
    const versionUuid = uuidv4()
    await cliStream.exec(
      `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        blockUuid,
        'scribe/markdown',
        versionUuid,
        null,
        new Date().toISOString(),
        'test',
        '# Test Document\n\nThis is a test.'
      ]
    )
    
    // Step 2: Simulate scribe-react loading the stream from a fresh database
    const freshDb = new PGlite()  // Fresh database!
    const reactClient = new TributaryClient({
      server: createTestServer(),
      db: freshDb
    })
    
    // Sync the stream to apply all transactions
    const reactStream = await reactClient.get('scribe', streamId)
    expect(reactStream).toBeDefined()
    await reactStream!.sync(100)
    
    // Get the local database
    const localDb = await reactClient.getLocal('scribe', streamId)
    expect(localDb).toBeDefined()
    
    // Step 3: Try to query - this should work if migrations are in the stream
    // Currently it will fail because migrations were never added to the stream
    await expect(async () => {
      await getAllBlocksWithTitles(localDb!)
    }).rejects.toThrow(/relation.*authoritative_version.*does not exist/)
  })

  it('should work with ensureMigrations() on a fresh database', async () => {
    // Step 1: Create stream in CLI and ensure migrations
    const cliClient = new TributaryClient({
      server: testServer,  // Use shared server
      db: testDb
    })
    
    const cliStream = await cliClient.addWriteKey('scribe', privateKey)
    
    // Use ensureMigrations(isNew=true) - this adds stream migrations to the stream
    await ensureMigrations(cliStream, true)
    
    // Insert a test block
    const blockUuid = uuidv4()
    const versionUuid = uuidv4()
    await cliStream.exec(
      `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        blockUuid,
        'scribe/markdown',
        versionUuid,
        null,
        new Date().toISOString(),
        'test',
        '# Test Document\n\nThis is a test.'
      ]
    )
    
    // Step 2: Simulate scribe-react loading from a FRESH database
    const freshDb = new PGlite()  // Completely fresh database!
    const reactClient = new TributaryClient({
      server: testServer,  // Use same shared server
      db: freshDb
    })
    
    // Add the stream (with the same key)
    const reactStream = await reactClient.addWriteKey('scribe', privateKey)
    expect(reactStream).toBeDefined()
    
    // Sync FIRST to get the stream migrations (block table creation)
    await reactStream!.sync(100)
    
    // Then run migrations for imported stream (isNew=false, only creates local tables)
    await ensureMigrations(reactStream!, false)
    
    // Get the local database
    const localDb = await reactClient.getLocal('scribe', streamId)
    expect(localDb).toBeDefined()
    
    // This should work because:
    // 1. Block table was created via sync (from stream)
    // 2. Local tables were created via ensureMigrations
    const blocks = await getAllBlocksWithTitles(localDb!)
    expect(blocks).toBeDefined()
    expect(blocks.length).toBe(0) // No indexed blocks yet (indexing is local-only)
  })

  it('ensureMigrations() should be idempotent', async () => {
    // Create a stream
    const client = new TributaryClient({
      server: createTestServer(),
      db: testDb
    })
    
    const stream = await client.addWriteKey('scribe', privateKey)
    
    // Call ensureMigrations multiple times with isNew=true - should not error
    await ensureMigrations(stream, true)
    await ensureMigrations(stream, false) // Calling with false should also work
    await ensureMigrations(stream, false)
    
    // Should still be able to use the stream
    const blockUuid = uuidv4()
    const versionUuid = uuidv4()
    await stream.exec(
      `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        blockUuid,
        'scribe/markdown',
        versionUuid,
        null,
        new Date().toISOString(),
        'test',
        '# Test Document\n\nThis is a test.'
      ]
    )
    
    // Verify we can query
    const result = await stream.query('SELECT COUNT(*) as count FROM block', [])
    expect(result.rows[0].count).toBe(1)
  })
})
