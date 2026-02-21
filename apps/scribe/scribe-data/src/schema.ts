/**
 * Database schema types for the scribe app
 */

/**
 * Database representation of a note
 */
export interface NoteTable {
  /**
   * Unique identifier for the note
   */
  block_uuid: string

  /**
   * Type of the note
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
   * The content of the note
   */
  body: string
}

/**
 * Database representation of an indexed note (non-synchronized)
 */
export interface IndexedNoteTable {
  /**
   * Unique identifier for the note
   */
  block_uuid: string

  /**
   * Version UUID of the authoritative version
   */
  version_uuid: string

  /**
   * Flag indicating if this note has been indexed
   */
  indexed: boolean

  /**
   * Timestamp of last index update (ISO string format)
   */
  last_indexed_at: string
}

/**
 * Database representation of a note slug (non-synchronized)
 */
export interface NoteSlugTable {
  /**
   * Unique identifier for the note
   */
  block_uuid: string

  /**
   * The URL-friendly slug derived from the note title
   */
  slug: string

  /**
   * The original title of the note
   */
  title: string

  /**
   * Timestamp when this slug was indexed (ISO string format)
   */
  indexed_at: string
}

/**
 * Database representation of authoritative versions (non-synchronized)
 * Maps note UUIDs to their authoritative (latest) version UUIDs
 */
export interface AuthoritativeVersionTable {
  /**
   * Unique identifier for the note
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
 * Database representation of note tags (non-synchronized)
 */
export interface NoteTagTable {
  /**
   * Unique identifier for the note
   */
  block_uuid: string

  /**
   * The tag extracted from the note
   */
  tag: string

  /**
   * Timestamp when this tag was indexed (ISO string format)
   */
  indexed_at: string
}

/**
 * Database representation of a collection (synchronized via Tributary)
 */
export interface CollectionTable {
  /**
   * Unique identifier for the collection
   */
  collection_uuid: string

  /**
   * Display title for the collection
   */
  title: string

  /**
   * Parent collection UUID (null = root collection)
   * Reserved for future nesting support; always null for now
   */
  parent_collection_uuid: string | null

  /**
   * Timestamp when this collection was created
   */
  insert_datetime: string

  /**
   * User or device that created this collection
   */
  inserter: string

  /**
   * Base64url-encoded public key of the linked library (null if not a linked collection)
   */
  linked_stream_id: string | null

  /**
   * Base64url-encoded private write key of the linked library (null if not a linked collection)
   */
  linked_stream_key: string | null
}

/**
 * Database representation of a note search index (non-synchronized)
 */
export interface NoteSearchIndexTable {
  /**
   * Unique identifier for the note
   */
  block_uuid: string

  /**
   * Version UUID of the indexed version
   */
  version_uuid: string

  /**
   * PostgreSQL tsvector for full-text search
   */
  search_vector: string  // Note: stored as TEXT in schema, but PostgreSQL treats it as TSVECTOR

  /**
   * Timestamp when this search vector was indexed (ISO string format)
   */
  indexed_at: string
}

/**
 * The main database schema for the scribe app
 */
export interface ScribeSchema {
  /**
   * Table containing all note versions
   */
  block: NoteTable

  /**
   * Table containing indexing status for notes (non-synchronized)
   */
  indexed_block: IndexedNoteTable

  /**
   * Table containing note slugs (non-synchronized)
   */
  block_slug: NoteSlugTable

  /**
   * Table containing authoritative version mappings (non-synchronized)
   */
  authoritative_version: AuthoritativeVersionTable

  /**
   * Table containing note tags (non-synchronized)
   */
  block_tag: NoteTagTable

  /**
   * Table containing note search indexes (non-synchronized)
   */
  block_search_index: NoteSearchIndexTable

  /**
   * Table containing collections (synchronized via Tributary)
   */
  collection: CollectionTable

}

/**
 * Full database schema including scribe tables
 */
export interface DatabaseSchema extends ScribeSchema {}
