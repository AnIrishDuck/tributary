/**
 * Core data types for the scribe app
 */

/**
 * Unique identifier for a note (UUID format)
 */
export type NoteUuid = string

/**
 * Unique identifier for a version (UUID format)
 */
export type VersionUuid = string

/**
 * Type of note - currently only scribe/markdown is supported
 */
export type NoteType = 'scribe/markdown'

/**
 * Unique identifier for a collection (UUID format)
 */
export type CollectionUuid = string

/**
 * User or device identifier that inserted a version
 */
export type Inserter = string

/**
 * Database representation of a note (with proper types for database storage)
 */
export interface Note {
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
  linked_stream_id: string | null
  linked_stream_key: string | null
}

/**
 * Database representation of a collection slug
 */
export interface CollectionSlug {
  collection_uuid: string
  slug: string
  title: string
  indexed_at: string
  parent_collection_uuid: string | null
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
 * Database representation of an indexed note (with proper types for database storage)
 */
export interface IndexedNote {
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
 * Type for a note slug database row
 */
export interface NoteSlug {
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
 * Type for a note tag database row
 */
export interface NoteTag {
  block_uuid: string;
  tag: string;
  indexed_at: string;
}

/**
 * Database representation of a note slug (with proper types for database storage)
 */
export interface NoteSlugRow {
  block_uuid: string
  slug: string
  title: string
  indexed_at: string // ISO string for database storage
  insert_datetime: string // ISO string - when the note was last edited
  collection_id: string | null
}

/**
 * Database representation of a note tag (with proper types for database storage)
 */
export interface NoteTagRow {
  block_uuid: string
  tag: string
  indexed_at: string // ISO string for database storage
}

/**
 * Type for a note with its authoritative version information
 */
export interface NoteWithVersion extends Note {
  /**
   * The authoritative version UUID for this note
   */
  authoritative_version_uuid: VersionUuid
}

/**
 * Type for a note with its slug
 */
export interface NoteWithSlug extends Note {
  /**
   * The URL-friendly slug for this note
   */
  slug: string
  
  /**
   * The title of the note
   */
  title: string
}

/**
 * Type for a note with its tags
 */
export interface NoteWithTags extends Note {
  /**
   * Array of tags for this note
   */
  tags: string[]
}

/**
 * Type for a complete indexed note with all metadata
 */
export interface IndexedNote extends NoteWithVersion, NoteWithSlug, NoteWithTags {}

/** A version summary returned by getVersionHistory. */
export interface VersionSummary {
  version_uuid: string
  prior_version_uuid: string | null
  insert_datetime: string
  inserter: string
  /** 1-based position in chronological order (1 = oldest). */
  position: number
  /** Total number of versions for this note. */
  total: number
  /** True when this is the authoritative (latest) version. */
  isAuthoritative: boolean
}

/** A node in a version tree. */
export interface VersionTreeNode {
  version_uuid: string
  prior_version_uuid: string | null
  insert_datetime: string
  inserter: string
  /** Whether this is the authoritative (latest) version. */
  isAuthoritative: boolean
}

// Re-export search types from search.ts
export type {
  SearchOptions,
  SearchResult,
  IndexSearchOptions,
  IndexSearchResult
} from './search.js'
