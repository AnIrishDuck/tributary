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
 * Unique identifier for a collection (UUID format)
 */
export type CollectionUuid = string

/**
 * User or device identifier that inserted a version
 */
export type Inserter = string

/**
 * Database representation of a block (with proper types for database storage)
 */
export interface Block {
  block_uuid: string
  block_type: string
  version_uuid: string
  prior_version_uuid: string | null
  insert_datetime: string // ISO string for database storage
  inserter: string
  body: string
  collection_id: string | null
}

/**
 * Database representation of a collection
 */
export interface Collection {
  collection_uuid: string
  title: string
  parent_collection_uuid: string | null
  insert_datetime: string
  inserter: string
}

/**
 * Database representation of a collection slug
 */
export interface CollectionSlug {
  collection_uuid: string
  slug: string
  title: string
  indexed_at: string
}

/**
 * Collection slug row with insert_datetime for listing
 */
export interface CollectionSlugRow {
  collection_uuid: string
  slug: string
  title: string
  indexed_at: string
  insert_datetime: string
}

/**
 * Database representation of an indexed block (with proper types for database storage)
 */
export interface IndexedBlock {
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
 * Type for a block slug database row
 */
export interface BlockSlug {
  block_uuid: string;
  slug: string;
  title: string;
  indexed_at: string;
}

/**
 * Type for an authoritative version database row
 */
export interface AuthoritativeVersion {
  block_uuid: string;
  version_uuid: string;
  indexed_at: string;
}

/**
 * Type for a block tag database row
 */
export interface BlockTag {
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
  insert_datetime: string // ISO string - when the block was last edited
  collection_id: string | null
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

// Re-export search types from search.ts
export type {
  SearchOptions,
  SearchResult,
  IndexSearchOptions,
  IndexSearchResult
} from './search.js'
