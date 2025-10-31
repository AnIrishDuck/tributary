import { v4 as uuidv4 } from 'uuid'
import { TributaryStream } from 'tributary-client'
import { BlockRow, BlockDBRow, PGliteResult } from './types'

interface BlockQueryResult {
  version_uuid: string;
}

/**
 * Create a new block in the database
 * 
 * @param db The TributaryStream database instance
 * @param blockData The block data to insert
 * @returns The inserted block record
 */
export async function createBlock(
  db: TributaryStream,
  blockData: {
    block_uuid?: string
    block_type: string
    body: string
    inserter: string
    prior_version_uuid?: string | null
  }
): Promise<BlockRow> {
  const now = new Date()
  
  const newBlock: BlockRow = {
    block_uuid: blockData.block_uuid || uuidv4(),
    block_type: blockData.block_type,
    version_uuid: uuidv4(),
    prior_version_uuid: blockData.prior_version_uuid !== undefined ? blockData.prior_version_uuid : null,
    insert_datetime: now.toISOString(),
    inserter: blockData.inserter,
    body: blockData.body
  }
  
  await db.exec(
    `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body) 
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      newBlock.block_uuid,
      newBlock.block_type,
      newBlock.version_uuid,
      newBlock.prior_version_uuid,
      newBlock.insert_datetime,
      newBlock.inserter,
      newBlock.body
    ]
  )
  
  // Retrieve the inserted block
  const result = await db.query(
    `SELECT * FROM block WHERE version_uuid = $1`,
    [newBlock.version_uuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    throw new Error('Failed to retrieve inserted block')
  }
  
  return result.rows[0] as BlockRow
}

/**
 * Create a new version of an existing block
 * 
 * @param db The TributaryStream database instance
 * @param block_uuid The UUID of the block to create a new version for
 * @param blockData The new block data
 * @returns The inserted block record
 */
export async function createBlockVersion(
  db: TributaryStream,
  block_uuid: string,
  blockData: {
    block_type: string
    body: string
    inserter: string
  }
): Promise<BlockRow> {
  // Get the latest version of this block to set as prior_version_uuid
  const result = await db.query(
    `SELECT version_uuid FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
    [block_uuid]
  )
  
  const versionResult = result.rows && result.rows.length > 0 ? result.rows[0] as BlockQueryResult : null
  const prior_version_uuid = versionResult ? versionResult.version_uuid : null
  
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
 * @param db The TributaryStream database instance
 * @param block_uuid The UUID of the block to retrieve
 * @returns The block record or null if not found
 */
export async function getBlockByUuid(
  db: TributaryStream,
  block_uuid: string
): Promise<BlockRow | null> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
    [block_uuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  
  return result.rows[0] as BlockRow
}

/**
 * Get all versions of a block
 * 
 * @param db The TributaryStream database instance
 * @param block_uuid The UUID of the block to retrieve versions for
 * @returns Array of block records ordered by insertion time
 */
export async function getBlockVersions(
  db: TributaryStream,
  block_uuid: string
): Promise<BlockRow[]> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 ORDER BY insert_datetime ASC`,
    [block_uuid]
  )
  
  return (result.rows || []) as BlockRow[]
}

/**
 * Get the latest version of a block
 * 
 * @param db The TributaryStream database instance
 * @param block_uuid The UUID of the block to retrieve
 * @returns The latest block record or null if not found
 */
export async function getLatestBlockVersion(
  db: TributaryStream,
  block_uuid: string
): Promise<BlockRow | null> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
    [block_uuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  
  return result.rows[0] as BlockRow
}
