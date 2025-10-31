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

/**
 * Database representation of an indexed block (with proper types for database storage)
 */
export interface IndexedBlockRow {
  block_uuid: string
  version_uuid: string
  indexed: boolean
  last_indexed_at: string // ISO string for database storage
}

/**
 * Type for PGLite query result
 */
export interface PGliteResult {
  rows: any[];
  affectedRows?: number;
}

/**
 * Type for a block database row (used for raw SQL queries)
 */
export interface BlockDBRow {
  block_uuid: string;
  block_type: string;
  version_uuid: string;
  prior_version_uuid: string | null;
  insert_datetime: string;
  inserter: string;
  body: string;
}

/**
 * Type for an indexed block database row
 */
export interface IndexedBlockDBRow {
  block_uuid: string;
  version_uuid: string;
  indexed: boolean;
  last_indexed_at: string;
}

/**
 * Type for a block slug database row
 */
export interface BlockSlugDBRow {
  block_uuid: string;
  slug: string;
  title: string;
  indexed_at: string;
}

/**
 * Type for an authoritative version database row
 */
export interface AuthoritativeVersionDBRow {
  block_uuid: string;
  version_uuid: string;
  indexed_at: string;
}

/**
 * Type for a block tag database row
 */
export interface BlockTagDBRow {
  block_uuid: string;
  tag: string;
  indexed_at: string;
}

/**
 * Database representation of a block slug (with proper types for database storage)
 */
export interface BlockSlugRow {
  block_uuid: string
  slug: string
  title: string
  indexed_at: string // ISO string for database storage
}

/**
 * Database representation of a block tag (with proper types for database storage)
 */
export interface BlockTagRow {
  block_uuid: string
  tag: string
  indexed_at: string // ISO string for database storage
}

/**
 * Type for a block with its authoritative version information
 */
export interface BlockWithVersion extends Block {
  /**
   * The authoritative version UUID for this block
   */
  authoritative_version_uuid: VersionUuid
}

/**
 * Type for a block with its slug
 */
export interface BlockWithSlug extends Block {
  /**
   * The URL-friendly slug for this block
   */
  slug: string
  
  /**
   * The title of the block
   */
  title: string
}

/**
 * Type for a block with its tags
 */
export interface BlockWithTags extends Block {
  /**
   * Array of tags for this block
   */
  tags: string[]
}

/**
 * Type for a complete indexed block with all metadata
 */
export interface IndexedBlock extends BlockWithVersion, BlockWithSlug, BlockWithTags {}
