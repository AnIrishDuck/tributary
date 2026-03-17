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
  slug: string
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
  slug: string
}

/**
 * Database representation of a collection slug.
 * Now backed by the synced `collection` table directly.
 */
export type CollectionSlug = Pick<Collection, 'collection_uuid' | 'slug' | 'title' | 'parent_collection_uuid'>

/**
 * Collection slug row with insert_datetime for listing.
 * Now backed by the synced `collection` table directly.
 */
export interface CollectionSlugRow {
  collection_uuid: string
  slug: string
  title: string
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
 * Type for a note slug database row.
 * Now backed by the synced `block` table directly (title extracted from body).
 */
export interface NoteSlug {
  block_uuid: string;
  slug: string;
  title: string;
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
 * Database representation of a note slug (with proper types for database storage).
 * Now backed by the synced `block` table directly (title extracted from body).
 */
export interface NoteSlugRow {
  block_uuid: string
  slug: string
  title: string
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

/**
 * Cached linked library row stored on the home stream's local DB
 */
export interface LinkedLibrary {
  stream_id: string
  title: string
  last_edited: string | null
  sync_current_index: number
  sync_final_index: number
  last_synced_at: string | null
  cached_at: string
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

/**
 * An item involved in a sync operation — either a local or remote block or collection.
 */
export interface SyncItem {
  /** Whether this is a block (note) or collection */
  type: 'block' | 'collection'
  /** Whether this item lives on the local filesystem or in the remote database */
  source: 'local' | 'remote'
  /** The item's UUID */
  uuid: string
  /** The item's slug (with unique de-collided slug if necessary) */
  slug: string
  /** Last authoritative modification time (ISO string) */
  datetime: string
}

/**
 * A sync operation describing a change that needs to be applied.
 *
 * - Create: a new item that needs to be created. `target.source`
 *   indicates where to create it: 'local' means write a new file
 *   to disk, 'remote' means insert a new record in the database.
 *
 * - Update: an existing item has a new authoritative version.
 *   `target` is the authoritative version; `from` is the stale
 *   version being replaced. `from` and `target` always have
 *   different sources (one local, one remote).
 *
 * - Move: an item has moved from one slug to another.
 *
 * Updates are listed and performed before moves for any items where
 * both operations apply.
 */
export type SyncOperation =
  | { kind: 'create'; target: SyncItem }
  | { kind: 'update'; from: SyncItem; target: SyncItem }
  | { kind: 'move'; from: SyncItem; to: SyncItem }

/**
 * Information about a library including last edit time and display name.
 * Used by getLibraries() and getHomeCollections().
 */
export interface LibraryInfo {
  libraryId: string
  lastEdited: string | null
  libraryTitle: string | null
}

/**
 * Result of resolving a library by its URL slug.
 */
export type LibrarySlugResult =
  | { type: 'resolved'; libraryId: string; libraryTitle: string | null }
  | { type: 'conflict'; matches: Array<{ libraryId: string; libraryTitle: string | null }> }
  | { type: 'not_found' }

// Re-export search types from search.ts
export type {
  SearchOptions,
  SearchResult,
  IndexSearchOptions,
  IndexSearchResult
} from './search.js'
