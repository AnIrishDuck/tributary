import { ColumnType, Generated, GeneratedAlways } from 'kysely'

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
  insert_datetime: ColumnType<Date, string, string>

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
 * The main database schema for the scribe app
 */
export interface ScribeSchema {
  /**
   * Table containing all block versions
   */
  block: BlockTable
}

/**
 * Full database schema including scribe tables
 */
export interface DatabaseSchema extends ScribeSchema {}
