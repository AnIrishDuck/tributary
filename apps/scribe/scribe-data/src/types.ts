/**
 * Core data types for the scribe app
 */

/**
 * Unique identifier for a block (UUID format)
 */
export type BlockUuid = string

/**
 * Unique identifier for a version (UUID format)
 */
export type VersionUuid = string

/**
 * Type of block - currently only scribe/markdown is supported
 */
export type BlockType = 'scribe/markdown'

/**
 * User or device identifier that inserted a version
 */
export type Inserter = string

/**
 * A block represents a unit of content in the scribe app
 */
export interface Block {
  /**
   * Unique identifier for the block (UUID format)
   */
  block_uuid: BlockUuid

  /**
   * Type of the block
   */
  block_type: BlockType

  /**
   * Unique identifier for this version (UUID format)
   */
  version_uuid: VersionUuid

  /**
   * Identifier for the previous version (null for first version, UUID format)
   */
  prior_version_uuid: VersionUuid | null

  /**
   * Timestamp when this version was inserted
   */
  insert_datetime: Date

  /**
   * User or device that inserted this version
   */
  inserter: Inserter

  /**
   * The content of the block
   */
  body: string
}

/**
 * Database representation of a block (with proper types for database storage)
 */
export interface BlockRow {
  block_uuid: string
  block_type: string
  version_uuid: string
  prior_version_uuid: string | null
  insert_datetime: string // ISO string for database storage
  inserter: string
  body: string
}
