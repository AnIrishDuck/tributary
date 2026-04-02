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

  /**
   * URL-friendly slug for this note, derived from title or block_uuid
   */
  slug: string
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
 * Database representation of a slug collision (non-synchronized).
 * Caches which (slug, parent) pairs have multiple items (notes and/or collections).
 */
export interface SlugCollisionTable {
  /**
   * The URL-friendly slug that has collisions
   */
  slug: string

  /**
   * The parent collection UUID where the collision occurs
   */
  parent_id: string
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

  /**
   * URL-friendly slug for this collection, derived from title
   */
  slug: string

  /**
   * JSON-serialized options for this collection (stored as TEXT).
   * Added by migrateAddCollectionOptions; may not exist on older libraries.
   */
  options?: string
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
 * Database representation of a cached linked library (non-synchronized).
 * Stored on the home stream's local DB to avoid N+1 queries on page load.
 */
export interface LinkedLibraryTable {
  /**
   * Base64url-encoded public key of the linked stream (primary key)
   */
  stream_id: string

  /**
   * Display title for the library
   */
  title: string

  /**
   * ISO string of the most recent note edit time, or null if no notes
   */
  last_edited: string | null

  /**
   * Current sync index (how many blobs have been synced)
   */
  sync_current_index: number

  /**
   * Final sync index (total blobs on the server)
   */
  sync_final_index: number

  /**
   * ISO string of last successful sync, or null if never synced
   */
  last_synced_at: string | null

  /**
   * ISO string of when this cache row was last updated
   */
  cached_at: string
}

/**
 * Database representation of a title index entry (non-synchronized).
 * Maps entity titles to their full slug paths for library-wide wikilink resolution.
 */
export interface TitleIndexTable {
  /**
   * Original title (case-preserved)
   */
  title: string

  /**
   * Lowercase title for case-insensitive lookup
   */
  title_lower: string

  /**
   * Type of entity: 'note' or 'collection'
   */
  entity_type: string

  /**
   * UUID of the entity (block_uuid or collection_uuid)
   */
  entity_uuid: string

  /**
   * Full slug path, e.g. 'cooking/italian/pasta'
   */
  slug_path: string
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
   * Table caching slug collisions (non-synchronized)
   */
  slug_collision: SlugCollisionTable

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

  /**
   * Table caching linked library metadata on the home stream (non-synchronized)
   */
  linked_libraries: LinkedLibraryTable

  /**
   * Table mapping entity titles to slug paths for wikilink resolution (non-synchronized)
   */
  title_index: TitleIndexTable

}

/**
 * Full database schema including scribe tables
 */
export interface DatabaseSchema extends ScribeSchema {}
