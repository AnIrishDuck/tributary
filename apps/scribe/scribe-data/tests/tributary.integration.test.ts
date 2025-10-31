import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { createTestDB } from './test-utils.js'
import { up } from '../src/migrations.js'
import { createBlock, createBlockVersion } from '../src/block.js'

describe('Tributary Integration Tests', () => {
  test('should create a new stream with Tributary integration', async () => {
    // Create a test database with Tributary client
    const { syncedDb, localDb, client, stream, server } = await createTestDB()
    
    try {
      // Run migrations on both databases, handling the case where tables already exist
      try {
        await up(syncedDb, localDb)
      } catch (error) {
        // Ignore "relation already exists" errors
        if (!(error as Error).message.includes('already exists')) {
          throw error
        }
      }
      
      // Check that we have a valid Tributary client
      expect(client).toBeDefined()
      
      // Check that we have a valid stream
      expect(stream).toBeDefined()
      
      // Insert a test block using the block functions
      const block = await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Test Document\n\nThis is a test document created through Tributary integration.',
        inserter: 'test-user'
      })
      
      const blockUuid = block.block_uuid
      const versionUuid = block.version_uuid
      
      // Retrieve the block
      const result = await syncedDb.query(
        `SELECT * FROM block WHERE block_uuid = $1`,
        [blockUuid]
      )
      
      const retrievedBlock = result.rows && result.rows.length > 0 ? result.rows[0] : null
      
      expect(retrievedBlock).toBeDefined()
      expect(retrievedBlock?.block_uuid).toBe(blockUuid)
      expect(retrievedBlock?.body).toBe('# Test Document\n\nThis is a test document created through Tributary integration.')
      
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
      // Cleanup handled by test framework
    }
  })

  test('should handle multiple blocks with proper versioning', async () => {
    // Create a test database with Tributary client
    const { syncedDb, localDb, client, stream, server } = await createTestDB()
    
    try {
      // Run migrations on both databases, handling the case where tables already exist
      try {
        await up(syncedDb, localDb)
      } catch (error) {
        // Ignore "relation already exists" errors
        if (!(error as Error).message.includes('already exists')) {
          throw error
        }
      }
      
      // Insert first version of a block using the block functions
      const blockV1 = await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# First Version\n\nThis is the first version of the document.',
        inserter: 'test-user'
      })
      
      const blockUuid = blockV1.block_uuid
      const version1Uuid = blockV1.version_uuid
      
      // Insert second version of the same block using the block functions
      const blockV2 = await createBlockVersion(syncedDb, blockUuid, {
        block_type: 'scribe/markdown',
        body: '# Second Version\n\nThis is the updated version of the document.',
        inserter: 'test-user'
      })
      
      const version2Uuid = blockV2.version_uuid
      
      // Retrieve both versions
      const result = await syncedDb.query(
        `SELECT * FROM block WHERE block_uuid = $1 ORDER BY insert_datetime`,
        [blockUuid]
      )
      
      const versions = result.rows || []
      
      expect(versions).toHaveLength(2)
      expect(versions[0].version_uuid).toBe(version1Uuid)
      expect(versions[0].body).toBe('# First Version\n\nThis is the first version of the document.')
      expect(versions[1].version_uuid).toBe(version2Uuid)
      expect(versions[1].body).toBe('# Second Version\n\nThis is the updated version of the document.')
      
      // Check blob storage
      const allBlobs = server.getAllBlobs()
      expect(allBlobs.length).toBeGreaterThan(1)
    } finally {
      // Cleanup handled by test framework
    }
  })
})
