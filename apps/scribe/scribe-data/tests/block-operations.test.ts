import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { Kysely, sql } from 'kysely'
import { v4 as uuidv4 } from 'uuid'
import { BlockUuid, VersionUuid, Block, BlockRecord, NewBlockRecord } from '../src/types.js'
import { up, down } from '../src/migrations.js'
import { createTestDB } from './test-utils.js'

describe('scribe-data migrations and operations', () => {
  let db: Kysely<any>
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    // Create a fresh test database for each test
    const result = await createTestDB()
    db = result.db
    cleanup = async () => {
      await db.destroy()
    }
    
    // Run the migration
    await up(db)
  })

  afterEach(async () => {
    // Clean up the database
    if (cleanup) {
      await cleanup()
    }
  })

  test('should create block table with correct schema', async () => {
    // Check that columns exist by trying to insert data with all required fields
    const now = new Date()
    const testInsert = await db.insertInto('block')
      .values({
        block_uuid: uuidv4(),
        block_type: 'scribe/markdown',
        version_uuid: uuidv4(),
        prior_version_uuid: null,
        insert_datetime: now.toISOString(),
        inserter: 'test-user',
        body: 'test body'
      } as NewBlockRecord)
      .executeTakeFirst()
    
    expect(testInsert).toBeDefined()
    
    // Check that we can select from the table
    const result: BlockRecord | undefined = await db.selectFrom('block').selectAll().executeTakeFirst()
    expect(result).toBeDefined()
    expect(result?.block_type).toBe('scribe/markdown')
  })

  test('should insert and retrieve a block', async () => {
    const now = new Date()
    const blockUuid = uuidv4() as BlockUuid
    const versionUuid = uuidv4() as VersionUuid
    
    const block: NewBlockRecord = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      version_uuid: versionUuid,
      prior_version_uuid: null,
      insert_datetime: now.toISOString(),
      inserter: 'user-1',
      body: '# Hello World\n\nThis is a test document.'
    }
    
    // Insert the block
    await db.insertInto('block')
      .values(block)
      .execute()
    
    // Retrieve the block
    const result: BlockRecord | undefined = await db.selectFrom('block')
      .selectAll()
      .where('block_uuid', '=', block.block_uuid)
      .executeTakeFirst()
    
    expect(result).toBeDefined()
    expect(result?.block_uuid).toBe(block.block_uuid)
    expect(result?.block_type).toBe(block.block_type)
    expect(result?.version_uuid).toBe(block.version_uuid)
    expect(result?.prior_version_uuid).toBe(null)
    expect(result?.inserter).toBe(block.inserter)
    expect(result?.body).toBe(block.body)
  })

  test('should enforce unique constraint on block_uuid and version_uuid', async () => {
    const now = new Date()
    const blockUuid = uuidv4()
    const versionUuid = uuidv4()
    
    const block1: NewBlockRecord = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      version_uuid: versionUuid,
      prior_version_uuid: null,
      insert_datetime: now.toISOString(),
      inserter: 'user-1',
      body: 'First version'
    }
    
    const block2: NewBlockRecord = {
      ...block1,
      body: 'Duplicate version' // Same block_uuid and version_uuid
    } as NewBlockRecord
    
    // Insert first block
    await db.insertInto('block').values(block1).execute()
    
    // Try to insert duplicate - should fail
    await expect(() => 
      db.insertInto('block').values(block2).execute()
    ).rejects.toThrow()
  })

  test('should allow multiple versions of the same block', async () => {
    const now = new Date()
    const blockUuid = uuidv4()
    const version1Uuid = uuidv4()
    const version2Uuid = uuidv4()
    
    const blockVersion1: NewBlockRecord = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      version_uuid: version1Uuid,
      prior_version_uuid: null,
      insert_datetime: now.toISOString(),
      inserter: 'user-1',
      body: 'First version'
    }
    
    const blockVersion2: NewBlockRecord = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      version_uuid: version2Uuid,
      prior_version_uuid: version1Uuid,
      insert_datetime: new Date(now.getTime() + 1000).toISOString(), // 1 second later
      inserter: 'user-1',
      body: 'Second version'
    }
    
    // Insert both versions
    await db.insertInto('block').values(blockVersion1).execute()
    await db.insertInto('block').values(blockVersion2).execute()
    
    // Retrieve both versions
    const results: BlockRecord[] = await db.selectFrom('block')
      .selectAll()
      .where('block_uuid', '=', blockUuid)
      .orderBy('insert_datetime')
      .execute()
    
    expect(results).toHaveLength(2)
    expect(results[0].version_uuid).toBe(version1Uuid)
    expect(results[0].body).toBe('First version')
    expect(results[1].version_uuid).toBe(version2Uuid)
    expect(results[1].body).toBe('Second version')
    expect(results[1].prior_version_uuid).toBe(version1Uuid)
  })

  test('should query all versions of a block', async () => {
    const now = new Date()
    const block1Uuid = uuidv4()
    const block2Uuid = uuidv4()
    const version11Uuid = uuidv4()
    const version12Uuid = uuidv4()
    const version21Uuid = uuidv4()
    
    // Insert multiple versions of different blocks
    const blocks: NewBlockRecord[] = [
      {
        block_uuid: block1Uuid,
        block_type: 'scribe/markdown',
        version_uuid: version11Uuid,
        prior_version_uuid: null,
        insert_datetime: now.toISOString(),
        inserter: 'user-1',
        body: 'Block 1, Version 1'
      },
      {
        block_uuid: block1Uuid,
        block_type: 'scribe/markdown',
        version_uuid: version12Uuid,
        prior_version_uuid: version11Uuid,
        insert_datetime: new Date(now.getTime() + 1000).toISOString(),
        inserter: 'user-1',
        body: 'Block 1, Version 2'
      },
      {
        block_uuid: block2Uuid,
        block_type: 'scribe/markdown',
        version_uuid: version21Uuid,
        prior_version_uuid: null,
        insert_datetime: now.toISOString(),
        inserter: 'user-2',
        body: 'Block 2, Version 1'
      }
    ]
    
    // Insert all blocks
    for (const block of blocks) {
      await db.insertInto('block').values(block).execute()
    }
    
    // Query all versions of block-1
    const block1Versions: BlockRecord[] = await db.selectFrom('block')
      .selectAll()
      .where('block_uuid', '=', block1Uuid)
      .orderBy('insert_datetime')
      .execute()
    
    expect(block1Versions).toHaveLength(2)
    expect(block1Versions[0].version_uuid).toBe(version11Uuid)
    expect(block1Versions[1].version_uuid).toBe(version12Uuid)
    
    // Query all versions of block-2
    const block2Versions: BlockRecord[] = await db.selectFrom('block')
      .selectAll()
      .where('block_uuid', '=', block2Uuid)
      .execute()
    
    expect(block2Versions).toHaveLength(1)
    expect(block2Versions[0].version_uuid).toBe(version21Uuid)
  })
})
