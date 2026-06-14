import { TributaryStream, TributaryLocal, migrate } from 'tributary-client'
import type { Migration, MigratableDb, MigrateOptions } from 'tributary-client'

// ---------------------------------------------------------------------------
// Synced migrations (tracked by the tributary migrate() system)
// ---------------------------------------------------------------------------

/**
 * Placeholder migration covering all synced tables that existed before the
 * formal migration system. On a new library every statement is executed; on
 * an existing library the statements are idempotent no-ops but the migration
 * gets recorded so later migrations know this baseline has been applied.
 */
export const untrackedSyncedMigrations: Migration = {
  name: '0000_untracked_migrations',
  up: async (db: MigratableDb) => {
    await db.exec(`
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

    // Safe to run on existing tables: PG ignores duplicate constraints
    try {
      await db.exec(`
        ALTER TABLE block
        ADD CONSTRAINT block_uuid_version_uuid_unique
        UNIQUE (block_uuid, version_uuid)
      `)
    } catch { /* constraint already exists */ }

    await db.exec(`
      CREATE INDEX IF NOT EXISTS block_slug_collection_id
      ON block (slug, collection_id)
    `)

    await db.exec(`
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

    await db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS collection_one_root
      ON collection ((1)) WHERE parent_collection_uuid IS NULL
    `)

    await db.exec(`
      CREATE INDEX IF NOT EXISTS collection_slug_parent
      ON collection (slug, parent_collection_uuid)
    `)

    await migrateAddPlugins(db)
  },
  down: async () => {
    // Intentionally empty — dropping these tables is destructive and not
    // reversible in a meaningful way.
  },
}

/**
 * Create the library_plugins synced table if it does not already exist.
 * Exported so it can be called lazily from ensurePluginTable / setLibraryPlugins
 * on libraries that predate the plugin system.
 */
export async function migrateAddPlugins(db: MigratableDb): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS library_plugins (
      plugin_url TEXT NOT NULL PRIMARY KEY,
      config_json TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `)
}

/** Add the `options` JSON column to the collection synced table. */
export const addCollectionOptions: Migration = {
  name: '0001_add_collection_options',
  up: async (db: MigratableDb) => {
    await db.exec(`
      ALTER TABLE collection ADD COLUMN IF NOT EXISTS options TEXT NOT NULL DEFAULT '{}'
    `)
  },
  down: async (db: MigratableDb) => {
    await db.exec(`ALTER TABLE collection DROP COLUMN IF EXISTS options`)
  },
}

/** Add the `archived` column to both block and collection synced tables. */
export const addArchivedColumn: Migration = {
  name: '0002_add_archived_column',
  up: async (db: MigratableDb) => {
    await db.exec(`
      ALTER TABLE block ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE
    `)
    await db.exec(`
      ALTER TABLE collection ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE
    `)
  },
  down: async (db: MigratableDb) => {
    await db.exec(`ALTER TABLE block DROP COLUMN IF EXISTS archived`)
    await db.exec(`ALTER TABLE collection DROP COLUMN IF EXISTS archived`)
  },
}

/**
 * Ordered list of formal synced migrations.
 * New synced migrations should be appended here.
 */
export const syncedMigrationList: Migration[] = [
  untrackedSyncedMigrations,
  addCollectionOptions,
  addArchivedColumn,
]

// ---------------------------------------------------------------------------
// Local migrations (tracked by the tributary migrate() system)
// ---------------------------------------------------------------------------

/**
 * Placeholder migration covering all local tables that existed before the
 * formal migration system. Idempotent on existing databases.
 */
export const untrackedLocalMigrations: Migration = {
  name: '0000_untracked_migrations',
  up: async (db: MigratableDb) => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS indexed_block (
        block_uuid TEXT NOT NULL PRIMARY KEY,
        version_uuid TEXT NOT NULL,
        indexed BOOLEAN NOT NULL,
        last_indexed_at TEXT NOT NULL
      )
    `)

    await db.exec(`
      CREATE TABLE IF NOT EXISTS authoritative_version (
        block_uuid TEXT NOT NULL PRIMARY KEY,
        version_uuid TEXT NOT NULL,
        indexed_at TEXT NOT NULL
      )
    `)

    await db.exec(`
      CREATE TABLE IF NOT EXISTS block_tag (
        block_uuid TEXT NOT NULL,
        tag TEXT NOT NULL,
        indexed_at TEXT NOT NULL,
        PRIMARY KEY (block_uuid, tag)
      )
    `)

    await db.exec(`
      CREATE TABLE IF NOT EXISTS block_search_index (
        block_uuid TEXT PRIMARY KEY,
        version_uuid TEXT NOT NULL,
        search_vector TSVECTOR NOT NULL,
        indexed_at TEXT NOT NULL
      )
    `)

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_block_search_vector
      ON block_search_index
      USING GIN (search_vector)
    `)

    await db.exec(`
      CREATE TABLE IF NOT EXISTS slug_collision (
        slug TEXT NOT NULL,
        parent_id TEXT NOT NULL,
        PRIMARY KEY (slug, parent_id)
      )
    `)

    await db.exec(`
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

    await db.exec(`
      CREATE TABLE IF NOT EXISTS title_index (
        title TEXT NOT NULL,
        title_lower TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_uuid TEXT NOT NULL,
        slug_path TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_uuid)
      )
    `)

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_title_index_lower ON title_index (title_lower)
    `)
  },
  down: async () => {
    // Intentionally empty — see untrackedSyncedMigrations.down
  },
}

/**
 * Ordered list of formal local migrations.
 * New local migrations should be appended here.
 */
export const localMigrationList: Migration[] = [
  untrackedLocalMigrations,
]

// ---------------------------------------------------------------------------
// Top-level entry points
// ---------------------------------------------------------------------------

/**
 * Create library-level tables (synchronized via Tributary).
 * This should be called ONLY when creating a new library.
 *
 * Accepts an optional `before` option (passed through to `migrate()`) so
 * tests can create a stream at an earlier schema version.
 */
export async function syncedMigrations(
  stream: TributaryStream,
  options?: Pick<MigrateOptions, 'before'>
): Promise<void> {
  await migrate(stream, syncedMigrationList, options)
}

/**
 * Create local-only tables (NOT synchronized).
 * This should be called on EVERY client after loading a library.
 */
export async function localMigrations(local: TributaryLocal): Promise<void> {
  await migrate(local, localMigrationList)
}

/**
 * Check whether all schema tables required for queries exist.
 * Returns true when the synced tables (`block`, `collection`) AND the
 * local tables (`authoritative_version`, `slug_collision`) are all present.
 * Pages join on these local tables, so schemaReady must gate on them too —
 * otherwise a progress-triggered re-render can attempt queries before
 * localMigrations has run.
 */
/**
 * Convenience function: run both synced and local migrations.
 */
export async function up(syncedDb: TributaryStream, localDb: TributaryLocal): Promise<void> {
  await syncedMigrations(syncedDb)
  await localMigrations(localDb)
}

export async function schemaReady(
  db: TributaryStream | TributaryLocal
): Promise<boolean> {
  try {
    await db.query('SELECT 1 FROM block LIMIT 0', [])
    await db.query('SELECT 1 FROM collection LIMIT 0', [])
    await db.query('SELECT 1 FROM library_plugins LIMIT 0', [])
    await db.query('SELECT 1 FROM authoritative_version LIMIT 0', [])
    await db.query('SELECT 1 FROM slug_collision LIMIT 0', [])
    // Most listing functions now filter on the archived column and would
    // throw without it, so gate on its existence.
    await db.query('SELECT archived FROM block LIMIT 0', [])
    await db.query('SELECT archived FROM collection LIMIT 0', [])
    return true
  } catch {
    return false
  }
}
