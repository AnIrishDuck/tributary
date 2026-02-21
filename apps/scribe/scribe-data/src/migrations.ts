import { PGlite } from '@electric-sql/pglite'
import { TributaryStream, TributaryLocal } from 'tributary-client'

/**
 * Create library-level tables (synchronized via Tributary)
 * These tables are part of the library and will be synced to all clients
 * This should be called ONLY when creating a new library
 */
export async function libraryMigrations(stream: TributaryStream): Promise<void> {
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

}

/**
 * Legacy migration function for backwards compatibility
 */
export async function up(syncedDb: TributaryStream, localDb: TributaryLocal): Promise<void> {
  await libraryMigrations(syncedDb)
  await localMigrations(localDb)
}

/**
 * Migration to drop the block table
 */
export async function down(syncedDb: TributaryStream, localDb: TributaryLocal): Promise<void> {
  await localDb.exec('DROP TABLE IF EXISTS block_search_index')
  await localDb.exec('DROP TABLE IF EXISTS block_tag')
  await localDb.exec('DROP TABLE IF EXISTS authoritative_version')
  await localDb.exec('DROP TABLE IF EXISTS block_slug')
  await localDb.exec('DROP TABLE IF EXISTS indexed_block')
  await syncedDb.exec('DROP TABLE IF EXISTS collection')
  await syncedDb.exec('DROP TABLE IF EXISTS block')
}

/**
 * Ensure migrations have been run for a library.
 * 
 * For NEW libraries: Runs library migrations (adds to library) + local migrations
 * For EXISTING libraries: Only runs local migrations (library already has tables from sync)
 * 
 * This is idempotent and safe to call multiple times.
 * 
 * @param stream The TributaryStream to ensure migrations for
 * @param isNew Whether this is a newly created library (default: auto-detect)
 */
export async function ensureMigrations(stream: TributaryStream, isNew?: boolean): Promise<void> {
  // If not explicitly told whether library is new, check by querying for block table
  if (isNew === undefined) {
    try {
      await stream.query('SELECT 1 FROM block LIMIT 1', [])
      // Block table exists, library is not new
      isNew = false
      console.log('Block table exists, library is not new')
    } catch (error: any) {
      if (error.message && error.message.includes('does not exist')) {
        // Block table doesn't exist, library is new
        isNew = true
        console.log('Block table does not exist, library is new')
      } else {
        // Some other error, re-throw
        throw error
      }
    }
  }
  
  // For new libraries, run library migrations to add tables to the library
  if (isNew) {
    console.log('Running library migrations for new library')
    await libraryMigrations(stream)
  }
  // For existing/imported libraries, library tables arrive via sync -- no stream.exec() needed

  // Always run local migrations (these are never in the library)
  console.log('Running local migrations')
  await localMigrations(stream.local())
}

/**
 * Run incremental migrations for existing libraries.
 * Checks for missing tables/columns and adds them if needed.
 */
async function incrementalLibraryMigrations(stream: TributaryStream): Promise<void> {
  // Check if collection table exists
  try {
    await stream.query('SELECT 1 FROM collection LIMIT 1', [])
  } catch (error: any) {
    if (error.message && error.message.includes('does not exist')) {
      console.log('Creating collection table for existing library')
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
    } else {
      throw error
    }
  }

  // Ensure root collection uniqueness constraint exists
  await stream.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS collection_one_root
    ON collection ((1)) WHERE parent_collection_uuid IS NULL
  `)

  // Check if collection.linked_stream_id column exists
  try {
    await stream.query(`SELECT linked_stream_id FROM collection LIMIT 1`, [])
  } catch (error: any) {
    if (error.message && error.message.includes('does not exist')) {
      console.log('Adding linked_stream_id column to collection table')
      await stream.exec(`ALTER TABLE collection ADD COLUMN linked_stream_id TEXT`)
    } else {
      throw error
    }
  }

  // Check if collection.linked_stream_key column exists
  try {
    await stream.query(`SELECT linked_stream_key FROM collection LIMIT 1`, [])
  } catch (error: any) {
    if (error.message && error.message.includes('does not exist')) {
      console.log('Adding linked_stream_key column to collection table')
      await stream.exec(`ALTER TABLE collection ADD COLUMN linked_stream_key TEXT`)
    } else {
      throw error
    }
  }

  // Check if block.collection_id column exists
  try {
    await stream.query(`SELECT collection_id FROM block LIMIT 1`, [])
  } catch (error: any) {
    if (error.message && error.message.includes('does not exist')) {
      console.log('Adding collection_id column to block table')
      await stream.exec(`ALTER TABLE block ADD COLUMN collection_id TEXT`)
    } else {
      throw error
    }
  }
}
