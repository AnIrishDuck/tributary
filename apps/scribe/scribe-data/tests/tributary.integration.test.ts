import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { createTestDB } from './test-utils.js'
import { up } from '../src/migrations.js'

describe('Tributary Integration Tests', () => {
  test('should create a new stream with Tributary integration', async () => {
    // Create a test database with Tributary client
    const { syncedDb, localDb, client, stream, server } = await createTestDB()
    
    try {
      // Run migrations on both databases, handling the case where tables already exist
      try {
        await up(syncedDb)
      } catch (error) {
        // Ignore "relation already exists" errors
        if (!error.message.includes('already exists')) {
          throw error
        }
      }
      
      try {
        await up(localDb)
      } catch (error) {
        // Ignore "relation already exists" errors
        if (!error.message.includes('already exists')) {
          throw error
        }
      }
      
      // Check that we have a valid Tributary client
      expect(client).toBeDefined()
      
      // Check that we have a valid stream
      expect(stream).toBeDefined()
      
      // Insert a test block
      const now = new Date()
      const blockUuid = uuidv4()
      const versionUuid = uuidv4()
      
      const block = {
        block_uuid: blockUuid,
        block_type: 'scribe/markdown',
        version_uuid: versionUuid,
        prior_version_uuid: null,
        insert_datetime: now.toISOString(),
        inserter: 'test-user',
        body: '# Test Document\n\nThis is a test document created through Tributary integration.'
      }
      
      // Insert the block
      await syncedDb.insertInto('block').values(block).execute()
      
      // Retrieve the block
      const result = await syncedDb.selectFrom('block')
        .selectAll()
        .where('block_uuid', '=', blockUuid)
        .executeTakeFirst()
      
      expect(result).toBeDefined()
      expect(result?.block_uuid).toBe(blockUuid)
      expect(result?.body).toBe('# Test Document\n\nThis is a test document created through Tributary integration.')
      
      // Check that we can retrieve blob metadata
      const allBlobs = server.getAllBlobs()
      expect(allBlobs.length).toBeGreaterThan(0)
      
      // Check that we can retrieve blob metadata
      if (allBlobs.length > 0) {
        const firstBlob = allBlobs[0]
        const latestBlob = await server.getLatestBlobMetadata(firstBlob.pubkey)
        expect(latestBlob).toBeDefined()
      }
    } finally {
      // Clean up
      await syncedDb.destroy()
      await localDb.destroy()
    }
  })

  test('should handle multiple blocks with proper versioning', async () => {
    // Create a test database with Tributary client
    const { syncedDb, localDb, client, stream, server } = await createTestDB()
    
    try {
      // Run migrations on both databases, handling the case where tables already exist
      try {
        await up(syncedDb)
      } catch (error) {
        // Ignore "relation already exists" errors
        if (!error.message.includes('already exists')) {
          throw error
        }
      }
      
      try {
        await up(localDb)
      } catch (error) {
        // Ignore "relation already exists" errors
        if (!error.message.includes('already exists')) {
          throw error
        }
      }
      
      const now = new Date()
      const blockUuid = uuidv4()
      const version1Uuid = uuidv4()
      const version2Uuid = uuidv4()
      
      // Insert first version of a block
      const blockV1 = {
        block_uuid: blockUuid,
        block_type: 'scribe/markdown',
        version_uuid: version1Uuid,
        prior_version_uuid: null,
        insert_datetime: now.toISOString(),
        inserter: 'test-user',
        body: '# First Version\n\nThis is the first version of the document.'
      }
      
      await syncedDb.insertInto('block').values(blockV1).execute()
      
      // Insert second version of the same block
      const blockV2 = {
        block_uuid: blockUuid,
        block_type: 'scribe/markdown',
        version_uuid: version2Uuid,
        prior_version_uuid: version1Uuid,
        insert_datetime: new Date(now.getTime() + 1000).toISOString(),
        inserter: 'test-user',
        body: '# Second Version\n\nThis is the updated version of the document.'
      }
      
      await syncedDb.insertInto('block').values(blockV2).execute()
      
      // Retrieve both versions
      const versions = await syncedDb.selectFrom('block')
        .selectAll()
        .where('block_uuid', '=', blockUuid)
        .orderBy('insert_datetime')
        .execute()
      
      expect(versions).toHaveLength(2)
      expect(versions[0].version_uuid).toBe(version1Uuid)
      expect(versions[0].body).toBe('# First Version\n\nThis is the first version of the document.')
      expect(versions[1].version_uuid).toBe(version2Uuid)
      expect(versions[1].body).toBe('# Second Version\n\nThis is the updated version of the document.')
      
      // Check blob storage
      const allBlobs = server.getAllBlobs()
      expect(allBlobs.length).toBeGreaterThan(1)
    } finally {
      // Clean up
      await syncedDb.destroy()
      await localDb.destroy()
    }
  })
})
