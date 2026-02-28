import { TributaryStream, TributaryLocal } from 'tributary-client'

/**
 * Create library-level tables (synchronized via Tributary)
 * These tables are part of the library and will be synced to all clients
 * This should be called ONLY when creating a new library
 */
export async function syncedMigrations(stream: TributaryStream): Promise<void> {
  // Create the block table
  await stream.exec(`
    CREATE TABLE IF NOT EXISTS block (
      block_uuid TEXT NOT NULL,
      block_type TEXT NOT NULL,
      version_uuid TEXT NOT NULL PRIMARY KEY,
      prior_version_uuid TEXT,
      insert_datetime TEXT NOT NULL,
      inserter TEXT NOT NULL,
      body TEXT NOT NULL,
      collection_id TEXT
    )
  `)

  await stream.exec(`
    ALTER TABLE block
    ADD CONSTRAINT block_uuid_version_uuid_unique
    UNIQUE (block_uuid, version_uuid)
  `)

  // Create the collection table
  await stream.exec(`
    CREATE TABLE IF NOT EXISTS collection (
      collection_uuid TEXT NOT NULL PRIMARY KEY,
      title TEXT NOT NULL,
      parent_collection_uuid TEXT,
      insert_datetime TEXT NOT NULL,
      inserter TEXT NOT NULL,
      linked_stream_id TEXT,
      linked_stream_key TEXT
    )
  `)

  // Enforce at most one root collection (parent_collection_uuid IS NULL) per library
  await stream.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS collection_one_root
    ON collection ((1)) WHERE parent_collection_uuid IS NULL
  `)
}

/**
 * Create local-only tables (NOT synchronized)
 * These tables are for local indexing and never go into the library
 * This should be called on EVERY client after loading a library
 */
export async function localMigrations(local: TributaryLocal): Promise<void> {
  // Create the indexed_block table for tracking indexing status (non-synchronized)
  await local.exec(`
    CREATE TABLE IF NOT EXISTS indexed_block (
      block_uuid TEXT NOT NULL PRIMARY KEY,
      version_uuid TEXT NOT NULL,
      indexed BOOLEAN NOT NULL,
      last_indexed_at TEXT NOT NULL
    )
  `)

  // Create the block_slug table for storing block slugs (non-synchronized)
  await local.exec(`
    CREATE TABLE IF NOT EXISTS block_slug (
      block_uuid TEXT NOT NULL PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    )
  `)

  // Create the authoritative_version table for mapping block UUIDs to their authoritative versions (non-synchronized)
  await local.exec(`
    CREATE TABLE IF NOT EXISTS authoritative_version (
      block_uuid TEXT NOT NULL PRIMARY KEY,
      version_uuid TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    )
  `)

  // Create the block_tag table for storing block tags (non-synchronized)
  await local.exec(`
    CREATE TABLE IF NOT EXISTS block_tag (
      block_uuid TEXT NOT NULL,
      tag TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      PRIMARY KEY (block_uuid, tag)
    )
  `)

  // Create the block_search_index table for full-text search (non-synchronized)
  await local.exec(`
    CREATE TABLE IF NOT EXISTS block_search_index (
      block_uuid TEXT PRIMARY KEY,
      version_uuid TEXT NOT NULL,
      search_vector TSVECTOR NOT NULL,
      indexed_at TEXT NOT NULL
    )
  `)

  // Create GIN index for fast full-text search
  await local.exec(`
    CREATE INDEX IF NOT EXISTS idx_block_search_vector
    ON block_search_index
    USING GIN (search_vector)
  `)

  // Create the collection_slug table for storing collection slugs (non-synchronized)
  await local.exec(`
    CREATE TABLE IF NOT EXISTS collection_slug (
      collection_uuid TEXT NOT NULL PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      parent_collection_uuid TEXT
    )
  `)

  // Create the linked_libraries table for caching linked library metadata (non-synchronized).
  // Only used on the home stream to avoid N+1 queries on page load.
  await local.exec(`
    CREATE TABLE IF NOT EXISTS linked_libraries (
      stream_id TEXT NOT NULL PRIMARY KEY,
      title TEXT NOT NULL,
      last_edited TEXT,
      sync_current_index INTEGER NOT NULL DEFAULT 0,
      sync_final_index INTEGER NOT NULL DEFAULT 0,
      last_synced_at TEXT,
      cached_at TEXT NOT NULL
    )
  `)

}

/**
 * Legacy migration function for backwards compatibility
 */
export async function up(syncedDb: TributaryStream, localDb: TributaryLocal): Promise<void> {
  await syncedMigrations(syncedDb)
  await localMigrations(localDb)
}

/**
 * Migration to drop the block table
 */
export async function down(syncedDb: TributaryStream, localDb: TributaryLocal): Promise<void> {
  await localDb.exec('DROP TABLE IF EXISTS linked_libraries')
  await localDb.exec('DROP TABLE IF EXISTS collection_slug')
  await localDb.exec('DROP TABLE IF EXISTS block_search_index')
  await localDb.exec('DROP TABLE IF EXISTS block_tag')
  await localDb.exec('DROP TABLE IF EXISTS authoritative_version')
  await localDb.exec('DROP TABLE IF EXISTS block_slug')
  await localDb.exec('DROP TABLE IF EXISTS indexed_block')
  await syncedDb.exec('DROP TABLE IF EXISTS collection')
  await syncedDb.exec('DROP TABLE IF EXISTS block')
}

