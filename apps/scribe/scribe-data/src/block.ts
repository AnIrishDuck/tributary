import { v4 as uuidv4 } from 'uuid'
import { TributaryStream, TributaryLocal } from 'tributary-client'
import { Block, PGliteResult } from './types'

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
    collection_id?: string | null
  }
): Promise<Block> {
  const now = new Date()

  const newBlock: Block = {
    block_uuid: blockData.block_uuid || uuidv4(),
    block_type: blockData.block_type,
    version_uuid: uuidv4(),
    prior_version_uuid: blockData.prior_version_uuid !== undefined ? blockData.prior_version_uuid : null,
    insert_datetime: now.toISOString(),
    inserter: blockData.inserter,
    body: blockData.body,
    collection_id: blockData.collection_id ?? null
  }

  await db.exec(
    `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body, collection_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      newBlock.block_uuid,
      newBlock.block_type,
      newBlock.version_uuid,
      newBlock.prior_version_uuid,
      newBlock.insert_datetime,
      newBlock.inserter,
      newBlock.body,
      newBlock.collection_id
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
  
  return result.rows[0] as Block
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
    collection_id?: string | null
  }
): Promise<Block> {
  // Get the latest version of this block to set as prior_version_uuid and carry forward collection_id
  const result = await db.query(
    `SELECT version_uuid, collection_id FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
    [block_uuid]
  )

  const versionResult = result.rows && result.rows.length > 0 ? result.rows[0] as any : null
  const prior_version_uuid = versionResult ? versionResult.version_uuid : null
  // Use explicitly provided collection_id, otherwise carry forward from latest version
  const collection_id = blockData.collection_id !== undefined ? blockData.collection_id : (versionResult?.collection_id ?? null)

  return createBlock(db, {
    block_uuid,
    block_type: blockData.block_type,
    body: blockData.body,
    inserter: blockData.inserter,
    prior_version_uuid,
    collection_id
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
): Promise<Block | null> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
    [block_uuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  
  return result.rows[0] as Block
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
): Promise<Block[]> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 ORDER BY insert_datetime ASC`,
    [block_uuid]
  )
  
  return (result.rows || []) as Block[]
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
): Promise<Block | null> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
    [block_uuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  
  return result.rows[0] as Block
}

/**
 * Get the count of all blocks in the database
 * 
 * @param db The TributaryStream database instance
 * @returns The number of blocks in the database
 */
export async function getBlockCount(
  db: TributaryStream
): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) as count FROM block`,
    []
  )
  
  if (!result.rows || result.rows.length === 0) {
    return 0
  }
  
  return parseInt((result.rows[0] as any).count)
}

/**
 * Get all blocks in the database
 * 
 * @param db The TributaryStream database instance
 * @returns Array of all block records
 */
export async function getAllBlocks(
  db: TributaryStream
): Promise<Block[]> {
  const result = await db.query(
    `SELECT * FROM block ORDER BY insert_datetime`,
    []
  )
  
  return (result.rows || []) as Block[]
}

/**
 * Get all authoritative (latest) blocks in the database
 * 
 * @param db The TributaryStream database instance
 * @returns Array of all authoritative block records
 */
export async function getAllAuthoritativeBlocks(
  db: TributaryStream
): Promise<Block[]> {
  const result = await db.query(`
    SELECT b.* 
    FROM block b
    INNER JOIN (
      SELECT block_uuid, MAX(insert_datetime) as max_datetime
      FROM block
      GROUP BY block_uuid
    ) latest ON b.block_uuid = latest.block_uuid AND b.insert_datetime = latest.max_datetime
    ORDER BY b.insert_datetime
  `, [])
  
  return (result.rows || []) as Block[]
}

/**
 * Get the count of versions for a specific block UUID
 * 
 * @param db The TributaryStream or TributaryLocal database instance
 * @param block_uuid The UUID of the block to count versions for
 * @returns The number of versions for the specified block
 */
export async function getBlockVersionCount(
  db: TributaryStream | TributaryLocal,
  block_uuid: string
): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) as count FROM block WHERE block_uuid = $1`,
    [block_uuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return 0
  }
  
  return parseInt((result.rows[0] as any).count)
}

/**
 * Get a block by its version UUID
 * 
 * @param db The TributaryStream or TributaryLocal database instance
 * @param block_uuid The UUID of the block
 * @param version_uuid The UUID of the version to retrieve
 * @returns The block record or null if not found
 */
export async function getBlockByVersion(
  db: TributaryStream | TributaryLocal,
  block_uuid: string,
  version_uuid: string
): Promise<Block | null> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 AND version_uuid = $2`,
    [block_uuid, version_uuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  
  return result.rows[0] as Block
}
