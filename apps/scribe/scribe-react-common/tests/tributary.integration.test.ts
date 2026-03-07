import { describe, it, expect } from 'vitest'
import { createTestDB } from 'scribe-data/tests/test-utils'
import { up } from 'scribe-data/src/migrations'
import { createNote } from 'scribe-data/src/note'

describe('Tributary Integration', () => {
  it('should create a Tributary client and initialize database', async () => {
    // Use the scribe-data test utility which sets up everything properly
    const { syncedDb, localDb, client, stream, server } = await createTestDB()
    
    try {
      // Check that we got a valid client and stream
      expect(client).toBeDefined()
      expect(stream).toBeDefined()
      expect(server).toBeDefined()
      
      // Check that databases are initialized
      expect(syncedDb).toBeDefined()
      expect(localDb).toBeDefined()
      
      // Run migrations on the synced database
      await up(syncedDb, localDb)
    } finally {
      // Clean up - only try to destroy if the method exists
      if (syncedDb && typeof (syncedDb as any).destroy === 'function') {
        await (syncedDb as any).destroy()
      }
      if (localDb && typeof (localDb as any).destroy === 'function') {
        await (localDb as any).destroy()
      }
    }
  })

  it('should be able to store and retrieve notes through Tributary', async () => {
    // Use the scribe-data test utility which sets up everything properly
    const { syncedDb, localDb, client, stream, server } = await createTestDB()
    
    try {
      // Run migrations to create the required tables
      await up(syncedDb, localDb)
      
      // Insert a test note using the scribe-data note module
      const block = await createNote(stream, {
        block_type: 'scribe/markdown',
        body: '# Test Document\n\nThis is a test document.',
        inserter: 'test-user'
      })
      
      // Retrieve the note using raw SQL
      const queryResult = await syncedDb.query(
        `SELECT * FROM block WHERE block_uuid = $1`,
        [block.block_uuid]
      )
      
      expect(queryResult.rows).toBeDefined()
      expect(queryResult.rows.length).toBe(1)
      const retrievedBlock = queryResult.rows[0]
      
      expect(retrievedBlock.block_uuid).toBe(block.block_uuid)
      expect(retrievedBlock.body).toBe('# Test Document\n\nThis is a test document.')
      
      // Check that the note was stored in the fake server
      const allBlobs = server.getAllBlobs()
      expect(allBlobs.length).toBeGreaterThan(0)
    } finally {
      // Clean up - only try to destroy if the method exists
      if (syncedDb && typeof (syncedDb as any).destroy === 'function') {
        await (syncedDb as any).destroy()
      }
      if (localDb && typeof (localDb as any).destroy === 'function') {
        await (localDb as any).destroy()
      }
    }
  })
})
