/**
 * Migration system for tributary apps.
 *
 * Provides a formal migration runner that works with both TributaryStream
 * (synced) and TributaryLocal (local-only) databases. Tracks applied
 * migrations in a dedicated table so incremental schema changes are reliable
 * and idempotent.
 */

/** Common query interface satisfied by both TributaryStream and TributaryLocal. */
export interface MigratableDb {
  query(sql: string, params?: any[]): Promise<{ rows: Record<string, any>[] }>;
  exec(sql: string, params?: any[]): Promise<void>;
  /** Default tracking table name for this db type. */
  defaultMigrationsTable: string;
  /**
   * The blob index of the last write operation, or null if the db
   * does not produce blobs (e.g. TributaryLocal).
   */
  lastBlobIndex: number | null;
}

/** A single migration with a unique name and up/down functions. */
export interface Migration {
  name: string;
  up: (db: MigratableDb) => Promise<void>;
  down: (db: MigratableDb) => Promise<void>;
}

/** Options for the migrate() function. */
export interface MigrateOptions {
  /** Name of the tracking table. Overrides the db's defaultMigrationsTable. */
  tableName?: string;
  /** Stop before this migration (exclusive). Useful for tests. */
  before?: string;
}

/** PostgreSQL error code for "undefined table". */
const UNDEFINED_TABLE = '42P01';
const BATCH_SIZE = 100;

/**
 * Ensure the migration tracking table exists.
 * Safe to call on databases that already have the table.
 */
async function ensureTrackingTable(db: MigratableDb, tableName: string): Promise<void> {
  await db.exec(
    `CREATE TABLE IF NOT EXISTS "${tableName}" (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL,
      blob_index INTEGER
    )`
  );
}

/**
 * Build a parameterized IN clause for a batch of names.
 * Returns { clause: '($1, $2, ...)', params: string[] }.
 */
function buildInClause(names: string[]): { clause: string; params: string[] } {
  const placeholders = names.map((_, i) => `$${i + 1}`).join(', ');
  return { clause: `(${placeholders})`, params: names };
}

/**
 * Run pending migrations against a database.
 *
 * Works with both TributaryStream and TributaryLocal. The tracking table
 * lives in the stream's schema (automatic via search_path).
 *
 * On a database with existing tables but no tracking table ("pre-migrations"
 * state), the tracking table is created automatically. Idempotent migrations
 * (CREATE TABLE IF NOT EXISTS) will be no-ops but still get recorded.
 */
export async function migrate(
  db: MigratableDb,
  migrations: Migration[],
  options?: MigrateOptions,
): Promise<void> {
  const tableName = options?.tableName ?? db.defaultMigrationsTable;

  await ensureTrackingTable(db, tableName);

  // Apply `before` filter: slice list to exclude the named migration and everything after.
  let list = migrations;
  if (options?.before != null) {
    const idx = migrations.findIndex((m) => m.name === options.before);
    if (idx === -1) {
      throw new Error(`Migration "${options.before}" not found in migration list`);
    }
    list = migrations.slice(0, idx);
  }

  // Process in batches.
  for (let offset = 0; offset < list.length; offset += BATCH_SIZE) {
    const batch = list.slice(offset, offset + BATCH_SIZE);
    const batchNames = batch.map((m) => m.name);

    // Find which migrations in this batch have already been applied.
    const { clause, params } = buildInClause(batchNames);
    const result = await db.query(
      `SELECT name FROM "${tableName}" WHERE name IN ${clause}`,
      params,
    );
    const applied = new Set<string>(result.rows.map((r) => r.name));

    // Run missing migrations in list order.
    for (const migration of batch) {
      if (applied.has(migration.name)) continue;

      console.info(`[tributary] Running migration "${migration.name}" (table: ${tableName})`);
      await migration.up(db);
      const blobIndex = db.lastBlobIndex;
      await db.exec(
        `INSERT INTO "${tableName}" (name, applied_at, blob_index) VALUES ($1, $2, $3)`,
        [migration.name, new Date().toISOString(), blobIndex],
      );
    }
  }
}

/**
 * Check whether a migration has been applied.
 *
 * Returns false (without throwing) when the tracking table does not exist.
 */
export async function hasMigration(
  db: MigratableDb,
  name: string,
  options?: { tableName?: string },
): Promise<boolean> {
  const tableName = options?.tableName ?? db.defaultMigrationsTable;
  try {
    const result = await db.query(
      `SELECT 1 FROM "${tableName}" WHERE name = $1`,
      [name],
    );
    return result.rows.length > 0;
  } catch (err: any) {
    if (err?.code === UNDEFINED_TABLE) {
      return false;
    }
    throw err;
  }
}
