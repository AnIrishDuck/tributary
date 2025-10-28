import { describe, it, expect } from 'vitest'
import { createTestDB } from 'scribe-data/tests/test-utils'
import { up } from 'scribe-data/src/migrations'

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
      await up(syncedDb)
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

  it('should be able to store and retrieve blocks through Tributary', async () => {
    // Use the scribe-data test utility which sets up everything properly
    const { syncedDb, localDb, client, stream, server } = await createTestDB()
    
    try {
      // Run migrations to create the required tables
      await up(syncedDb)
      
      // Insert a test block
      const now = new Date()
      const block = {
        block_uuid: 'test-block-uuid',
        block_type: 'scribe/markdown',
        version_uuid: 'test-version-uuid',
        prior_version_uuid: null,
        insert_datetime: now.toISOString(),
        inserter: 'test-user',
        body: '# Test Document\n\nThis is a test document.'
      }
      
      // Insert the block through Tributary
      const result = await syncedDb.insertInto('block').values(block).executeTakeFirst()
      expect(result).toBeDefined()
      
      // Retrieve the block
      const retrievedBlock = await syncedDb.selectFrom('block')
        .selectAll()
        .where('block_uuid', '=', 'test-block-uuid')
        .executeTakeFirst()
      
      expect(retrievedBlock).toBeDefined()
      expect(retrievedBlock?.block_uuid).toBe('test-block-uuid')
      expect(retrievedBlock?.body).toBe('# Test Document\n\nThis is a test document.')
      
      // Check that the block was stored in the fake server
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
