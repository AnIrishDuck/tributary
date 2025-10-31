import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { BlockUuid, VersionUuid } from '../src/types.js'
import { up, down } from '../src/migrations.js'
import { createTestDB } from './test-utils.js'
import { 
  createBlock, 
  createBlockVersion, 
  getBlockByUuid, 
  getBlockVersions, 
  getLatestBlockVersion 
} from '../src/block.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'

describe('Block Operations', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    // Create a fresh test database for each test
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    cleanup = async () => {
      // Cleanup handled by test framework
    }
    
    // Run the migration
    await up(syncedDb, localDb)
  })

  afterEach(async () => {
    // Clean up the database
    if (cleanup) {
      await cleanup()
    }
  })

  test('should create a new block with auto-generated UUIDs', async () => {
    const blockData = {
      block_type: 'scribe/markdown',
      body: '# Test Document\n\nThis is a test document.',
      inserter: 'test-user'
    }
    
    const createdBlock = await createBlock(syncedDb, blockData)
    
    expect(createdBlock).toBeDefined()
    expect(createdBlock.block_uuid).toBeDefined()
    expect(createdBlock.version_uuid).toBeDefined()
    expect(createdBlock.block_type).toBe(blockData.block_type)
    expect(createdBlock.body).toBe(blockData.body)
    expect(createdBlock.inserter).toBe(blockData.inserter)
    expect(createdBlock.prior_version_uuid).toBeNull()
    expect(createdBlock.insert_datetime).toBeDefined()
  })

  test('should create a new block with specified UUIDs', async () => {
    const blockUuid = uuidv4() as BlockUuid
    
    const blockData = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Test Document\n\nThis is a test document.',
      inserter: 'test-user'
    }
    
    const createdBlock = await createBlock(syncedDb, blockData)
    
    expect(createdBlock).toBeDefined()
    expect(createdBlock.block_uuid).toBe(blockUuid)
    expect(createdBlock.version_uuid).toBeDefined()
    expect(createdBlock.block_type).toBe(blockData.block_type)
    expect(createdBlock.body).toBe(blockData.body)
    expect(createdBlock.inserter).toBe(blockData.inserter)
    expect(createdBlock.prior_version_uuid).toBeNull()
  })

  test('should create a new version of an existing block', async () => {
    // First create an initial block
    const blockUuid = uuidv4() as BlockUuid
    const initialBlockData = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Initial Version\n\nThis is the first version.',
      inserter: 'test-user'
    }
    
    const initialBlock = await createBlock(syncedDb, initialBlockData)
    
    // Now create a new version
    const newVersionData = {
      block_type: 'scribe/markdown',
      body: '# Updated Version\n\nThis is the updated version.',
      inserter: 'test-user'
    }
    
    const newVersion = await createBlockVersion(syncedDb, blockUuid, newVersionData)
    
    expect(newVersion).toBeDefined()
    expect(newVersion.block_uuid).toBe(blockUuid)
    expect(newVersion.version_uuid).not.toBe(initialBlock.version_uuid)
    expect(newVersion.prior_version_uuid).toBe(initialBlock.version_uuid)
    expect(newVersion.body).toBe(newVersionData.body)
  })

  test('should retrieve a block by UUID', async () => {
    // Create a block
    const blockData = {
      block_type: 'scribe/markdown',
      body: '# Test Document\n\nThis is a test document.',
      inserter: 'test-user'
    }
    
    const createdBlock = await createBlock(syncedDb, blockData)
    
    // Retrieve the block
    const retrievedBlock = await getBlockByUuid(syncedDb, createdBlock.block_uuid)
    
    expect(retrievedBlock).toBeDefined()
    expect(retrievedBlock?.block_uuid).toBe(createdBlock.block_uuid)
    expect(retrievedBlock?.body).toBe(createdBlock.body)
  })

  test('should retrieve the latest version when multiple versions exist', async () => {
    const blockUuid = uuidv4() as BlockUuid
    
    // Create first version
    const version1 = await createBlock(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 1\n\nFirst version.',
      inserter: 'test-user'
    })
    
    // Create second version
    const version2 = await createBlock(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 2\n\nSecond version.',
      inserter: 'test-user',
      prior_version_uuid: version1.version_uuid
    })
    
    // Retrieve the block by UUID (should get latest version)
    const retrievedBlock = await getBlockByUuid(syncedDb, blockUuid)
    
    expect(retrievedBlock).toBeDefined()
    expect(retrievedBlock?.version_uuid).toBe(version2.version_uuid)
    expect(retrievedBlock?.body).toBe(version2.body)
  })

  test('should return null when retrieving non-existent block', async () => {
    const nonExistentUuid = uuidv4() as BlockUuid
    
    const retrievedBlock = await getBlockByUuid(syncedDb, nonExistentUuid)
    
    expect(retrievedBlock).toBeNull()
  })

  test('should retrieve all versions of a block', async () => {
    const blockUuid = uuidv4() as BlockUuid
    
    // Create first version
    const version1 = await createBlock(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 1\n\nFirst version.',
      inserter: 'test-user'
    })
    
    // Create second version
    const version2 = await createBlock(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 2\n\nSecond version.',
      inserter: 'test-user',
      prior_version_uuid: version1.version_uuid
    })
    
    // Retrieve all versions
    const versions = await getBlockVersions(syncedDb, blockUuid)
    
    expect(versions).toHaveLength(2)
    expect(versions[0].version_uuid).toBe(version1.version_uuid)
    expect(versions[1].version_uuid).toBe(version2.version_uuid)
  })

  test('should retrieve latest version of a block', async () => {
    const blockUuid = uuidv4() as BlockUuid
    
    // Create first version
    const version1 = await createBlock(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 1\n\nFirst version.',
      inserter: 'test-user'
    })
    
    // Create second version
    const version2 = await createBlock(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 2\n\nSecond version.',
      inserter: 'test-user',
      prior_version_uuid: version1.version_uuid
    })
    
    // Retrieve latest version
    const latestVersion = await getLatestBlockVersion(syncedDb, blockUuid)
    
    expect(latestVersion).toBeDefined()
    expect(latestVersion?.version_uuid).toBe(version2.version_uuid)
    expect(latestVersion?.body).toBe(version2.body)
  })

  test('should return null when retrieving latest version of non-existent block', async () => {
    const nonExistentUuid = uuidv4() as BlockUuid
    
    const latestVersion = await getLatestBlockVersion(syncedDb, nonExistentUuid)
    
    expect(latestVersion).toBeNull()
  })
})
