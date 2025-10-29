import { Kysely } from 'kysely'
import { v4 as uuidv4 } from 'uuid'
import { Database, NewBlockRecord, BlockRecord, BlockUuid, VersionUuid } from './types'

/**
 * Create a new block in the database
 * 
 * @param db The Kysely database instance
 * @param blockData The block data to insert
 * @returns The inserted block record
 */
export async function createBlock(
  db: Kysely<Database>,
  blockData: {
    block_uuid?: BlockUuid
    block_type: string
    body: string
    inserter: string
    prior_version_uuid?: VersionUuid | null
  }
): Promise<BlockRecord> {
  const now = new Date()
  
  const newBlock: NewBlockRecord = {
    block_uuid: blockData.block_uuid || (uuidv4() as BlockUuid),
    block_type: blockData.block_type,
    version_uuid: uuidv4() as VersionUuid,
    prior_version_uuid: blockData.prior_version_uuid !== undefined ? blockData.prior_version_uuid : null,
    insert_datetime: now.toISOString(),
    inserter: blockData.inserter,
    body: blockData.body
  }
  
  const result = await db.insertInto('block').values(newBlock).executeTakeFirst()
  
  // Retrieve the inserted block - explicitly check that version_uuid is defined
  const versionUuid = newBlock.version_uuid;
  if (!versionUuid) {
    throw new Error('Failed to generate version UUID')
  }
  
  const insertedBlock = await db.selectFrom('block')
    .selectAll()
    .where('version_uuid', '=', versionUuid)
    .executeTakeFirst()
  
  if (!insertedBlock) {
    throw new Error('Failed to retrieve inserted block')
  }
  
  return insertedBlock
}

/**
 * Create a new version of an existing block
 * 
 * @param db The Kysely database instance
 * @param block_uuid The UUID of the block to create a new version for
 * @param blockData The new block data
 * @returns The inserted block record
 */
export async function createBlockVersion(
  db: Kysely<Database>,
  block_uuid: BlockUuid,
  blockData: {
    block_type: string
    body: string
    inserter: string
  }
): Promise<BlockRecord> {
  // Get the latest version of this block to set as prior_version_uuid
  const latestVersion = await db.selectFrom('block')
    .selectAll()
    .where('block_uuid', '=', block_uuid)
    .orderBy('insert_datetime', 'desc')
    .limit(1)
    .executeTakeFirst()
  
  const prior_version_uuid = latestVersion?.version_uuid || null
  
  return createBlock(db, {
    block_uuid,
    block_type: blockData.block_type,
    body: blockData.body,
    inserter: blockData.inserter,
    prior_version_uuid
  })
}

/**
 * Get a block by its UUID
 * 
 * @param db The Kysely database instance
 * @param block_uuid The UUID of the block to retrieve
 * @returns The block record or null if not found
 */
export async function getBlockByUuid(
  db: Kysely<Database>,
  block_uuid: BlockUuid
): Promise<BlockRecord | null> {
  return await db.selectFrom('block')
    .selectAll()
    .where('block_uuid', '=', block_uuid)
    .orderBy('insert_datetime', 'desc')
    .limit(1)
    .executeTakeFirst() || null
}

/**
 * Get all versions of a block
 * 
 * @param db The Kysely database instance
 * @param block_uuid The UUID of the block to retrieve versions for
 * @returns Array of block records ordered by insertion time
 */
export async function getBlockVersions(
  db: Kysely<Database>,
  block_uuid: BlockUuid
): Promise<BlockRecord[]> {
  return await db.selectFrom('block')
    .selectAll()
    .where('block_uuid', '=', block_uuid)
    .orderBy('insert_datetime', 'asc')
    .execute()
}

/**
 * Get the latest version of a block
 * 
 * @param db The Kysely database instance
 * @param block_uuid The UUID of the block to retrieve
 * @returns The latest block record or null if not found
 */
export async function getLatestBlockVersion(
  db: Kysely<Database>,
  block_uuid: BlockUuid
): Promise<BlockRecord | null> {
  return await db.selectFrom('block')
    .selectAll()
    .where('block_uuid', '=', block_uuid)
    .orderBy('insert_datetime', 'desc')
    .limit(1)
    .executeTakeFirst() || null
}
