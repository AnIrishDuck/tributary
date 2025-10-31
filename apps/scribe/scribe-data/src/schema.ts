/**
 * Database schema types for the scribe app
 */

/**
 * Database representation of a block
 */
export interface BlockTable {
  /**
   * Unique identifier for the block
   */
  block_uuid: string

  /**
   * Type of the block
   */
  block_type: string

  /**
   * Unique identifier for this version
   */
  version_uuid: string

  /**
   * Identifier for the previous version (null for first version)
   */
  prior_version_uuid: string | null

  /**
   * Timestamp when this version was inserted
   */
  insert_datetime: string

  /**
   * User or device that inserted this version
   */
  inserter: string

  /**
   * The content of the block
   */
  body: string
}

/**
 * Database representation of an indexed block (non-synchronized)
 */
export interface IndexedBlockTable {
  /**
   * Unique identifier for the block
   */
  block_uuid: string

  /**
   * Version UUID of the authoritative version
   */
  version_uuid: string

  /**
   * Flag indicating if this block has been indexed
   */
  indexed: boolean

  /**
   * Timestamp of last index update (ISO string format)
   */
  last_indexed_at: string
}

/**
 * Database representation of a block slug (non-synchronized)
 */
export interface BlockSlugTable {
  /**
   * Unique identifier for the block
   */
  block_uuid: string

  /**
   * The URL-friendly slug derived from the block title
   */
  slug: string

  /**
   * The original title of the block
   */
  title: string

  /**
   * Timestamp when this slug was indexed (ISO string format)
   */
  indexed_at: string
}

/**
 * Database representation of authoritative versions (non-synchronized)
 * Maps block UUIDs to their authoritative (latest) version UUIDs
 */
export interface AuthoritativeVersionTable {
  /**
   * Unique identifier for the block
   */
  block_uuid: string

  /**
   * Version UUID of the authoritative version
   */
  version_uuid: string

  /**
   * Timestamp when this mapping was last updated (ISO string format)
   */
  indexed_at: string
}

/**
 * Database representation of block tags (non-synchronized)
 */
export interface BlockTagTable {
  /**
   * Unique identifier for the block
   */
  block_uuid: string

  /**
   * The tag extracted from the block
   */
  tag: string

  /**
   * Timestamp when this tag was indexed (ISO string format)
   */
  indexed_at: string
}

/**
 * The main database schema for the scribe app
 */
export interface ScribeSchema {
  /**
   * Table containing all block versions
   */
  block: BlockTable

  /**
   * Table containing indexing status for blocks (non-synchronized)
   */
  indexed_block: IndexedBlockTable

  /**
   * Table containing block slugs (non-synchronized)
   */
  block_slug: BlockSlugTable

  /**
   * Table containing authoritative version mappings (non-synchronized)
   */
  authoritative_version: AuthoritativeVersionTable

  /**
   * Table containing block tags (non-synchronized)
   */
  block_tag: BlockTagTable
}

/**
 * Full database schema including scribe tables
 */
export interface DatabaseSchema extends ScribeSchema {}
