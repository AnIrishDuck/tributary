import { TributaryStream, TributaryLocal, migrate } from 'tributary-client'
import type { Migration, MigratableDb, MigrateOptions } from 'tributary-client'

/**
 * Create library-level tables (synchronized via Tributary)
 * These tables are part of the library and will be synced to all clients
 * This should be called ONLY when creating a new library
 *
 * Accepts an optional `before` option (passed through to `migrate()`) so
 * tests can create a stream at an earlier schema version.
 */
export async function syncedMigrations(
  stream: TributaryStream,
  options?: Pick<MigrateOptions, 'before'>
): Promise<void> {
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
      collection_id TEXT,
      slug TEXT NOT NULL
    )
  `)

  await stream.exec(`
    ALTER TABLE block
    ADD CONSTRAINT block_uuid_version_uuid_unique
    UNIQUE (block_uuid, version_uuid)
  `)

  // Index for slug resolution: WHERE slug = $1 AND collection_id = $2
  await stream.exec(`
    CREATE INDEX IF NOT EXISTS block_slug_collection_id
    ON block (slug, collection_id)
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
      linked_stream_key TEXT,
      slug TEXT NOT NULL
    )
  `)

  // Enforce at most one root collection (parent_collection_uuid IS NULL) per library
  await stream.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS collection_one_root
    ON collection ((1)) WHERE parent_collection_uuid IS NULL
  `)

  // Index for collection slug resolution: WHERE slug = $1 AND parent_collection_uuid = $2
  await stream.exec(`
    CREATE INDEX IF NOT EXISTS collection_slug_parent
    ON collection (slug, parent_collection_uuid)
  `)

  await migrateAddPlugins(stream)

  // Run all formal synced migrations (currently: collection options)
  await migrate(stream, syncedMigrationList, options)
}

/**
 * Create the library_plugins synced table if it does not already exist.
 * Factored out so it can be called both from syncedMigrations (new libraries)
 * and lazily from getLibraryPlugins (existing libraries created before plugins).
 */
export async function migrateAddPlugins(stream: TributaryStream): Promise<void> {
  await stream.exec(`
    CREATE TABLE IF NOT EXISTS library_plugins (
      plugin_url TEXT NOT NULL PRIMARY KEY,
      config_json TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `)
}

// ---------------------------------------------------------------------------
// Formal synced migrations (tracked by the tributary migrate() system)
// ---------------------------------------------------------------------------

/** Add the `options` JSON column to the collection synced table. */
export const addCollectionOptions: Migration = {
  name: 'add_collection_options',
  up: async (db: MigratableDb) => {
    await db.exec(`
      ALTER TABLE collection ADD COLUMN IF NOT EXISTS options TEXT NOT NULL DEFAULT '{}'
    `)
  },
  down: async (db: MigratableDb) => {
    await db.exec(`ALTER TABLE collection DROP COLUMN IF EXISTS options`)
  },
}

/**
 * Ordered list of formal synced migrations.
 * New synced migrations should be appended here.
 */
export const syncedMigrationList: Migration[] = [
  addCollectionOptions,
]

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

  // Create the slug_collision table for caching which (slug, parent) pairs have
  // multiple items (notes and/or collections). Small, fully rebuilt on each index.
  await local.exec(`
    CREATE TABLE IF NOT EXISTS slug_collision (
      slug TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      PRIMARY KEY (slug, parent_id)
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

  // Create the title_index table for wikilink title lookups (non-synchronized).
  // Maps entity titles to their full slug paths for library-wide title-based linking.
  await local.exec(`
    CREATE TABLE IF NOT EXISTS title_index (
      title TEXT NOT NULL,
      title_lower TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_uuid TEXT NOT NULL,
      slug_path TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_uuid)
    )
  `)

  await local.exec(`
    CREATE INDEX IF NOT EXISTS idx_title_index_lower ON title_index (title_lower)
  `)

}

/**
 * Check whether all schema tables required for queries exist.
 * Returns true when the synced tables (`block`, `collection`) AND the
 * local tables (`authoritative_version`, `slug_collision`) are all present.
 * Pages join on these local tables, so schemaReady must gate on them too —
 * otherwise a progress-triggered re-render can attempt queries before
 * localMigrations has run.
 */
export async function schemaReady(
  db: TributaryStream | TributaryLocal
): Promise<boolean> {
  try {
    await db.query('SELECT 1 FROM block LIMIT 0', [])
    await db.query('SELECT 1 FROM collection LIMIT 0', [])
    await db.query('SELECT 1 FROM library_plugins LIMIT 0', [])
    await db.query('SELECT 1 FROM authoritative_version LIMIT 0', [])
    await db.query('SELECT 1 FROM slug_collision LIMIT 0', [])
    return true
  } catch {
    return false
  }
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
  await localDb.exec('DROP TABLE IF EXISTS title_index')
  await localDb.exec('DROP TABLE IF EXISTS linked_libraries')
  await localDb.exec('DROP TABLE IF EXISTS slug_collision')
  await localDb.exec('DROP TABLE IF EXISTS block_search_index')
  await localDb.exec('DROP TABLE IF EXISTS block_tag')
  await localDb.exec('DROP TABLE IF EXISTS authoritative_version')
  await localDb.exec('DROP TABLE IF EXISTS indexed_block')
  await syncedDb.exec('DROP TABLE IF EXISTS library_plugins')
  // Run down() for each formal migration in reverse order
  for (const m of [...syncedMigrationList].reverse()) {
    await m.down(syncedDb)
  }
  await syncedDb.exec('DROP TABLE IF EXISTS collection')
  await syncedDb.exec('DROP TABLE IF EXISTS block')
}
