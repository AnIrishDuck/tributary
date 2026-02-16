import { PGlite } from '@electric-sql/pglite'
import { TributaryStream, TributaryLocal } from 'tributary-client'

/**
 * Create stream-level tables (synchronized via Tributary)
 * These tables are part of the stream and will be synced to all clients
 * This should be called ONLY when creating a new stream
 */
export async function streamMigrations(stream: TributaryStream): Promise<void> {
  // Create the block table
  await stream.exec(`
    CREATE TABLE IF NOT EXISTS block (
      block_uuid TEXT NOT NULL,
      block_type TEXT NOT NULL,
      version_uuid TEXT NOT NULL PRIMARY KEY,
      prior_version_uuid TEXT,
      insert_datetime TEXT NOT NULL,
      inserter TEXT NOT NULL,
      body TEXT NOT NULL
    )
  `)

  await stream.exec(`
    ALTER TABLE block 
    ADD CONSTRAINT block_uuid_version_uuid_unique 
    UNIQUE (block_uuid, version_uuid)
  `)
}

/**
 * Create local-only tables (NOT synchronized)
 * These tables are for local indexing and never go into the stream
 * This should be called on EVERY client after loading a stream
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
}

/**
 * Legacy migration function for backwards compatibility
 */
export async function up(syncedDb: TributaryStream, localDb: TributaryLocal): Promise<void> {
  await streamMigrations(syncedDb)
  await localMigrations(localDb)
}

/**
 * Migration to drop the block table
 */
export async function down(syncedDb: TributaryStream, localDb: TributaryLocal): Promise<void> {
  await localDb.exec('DROP TABLE IF EXISTS block_tag')
  await localDb.exec('DROP TABLE IF EXISTS authoritative_version')
  await localDb.exec('DROP TABLE IF EXISTS block_slug')
  await localDb.exec('DROP TABLE IF EXISTS indexed_block')
  await syncedDb.exec('DROP TABLE IF EXISTS block')
}

/**
 * Ensure migrations have been run for a stream.
 * 
 * For NEW streams: Runs stream migrations (adds to stream) + local migrations
 * For EXISTING streams: Only runs local migrations (stream already has tables from sync)
 * 
 * This is idempotent and safe to call multiple times.
 * 
 * @param stream The TributaryStream to ensure migrations for
 * @param isNew Whether this is a newly created stream (default: auto-detect)
 */
export async function ensureMigrations(stream: TributaryStream, isNew?: boolean): Promise<void> {
  // If not explicitly told whether stream is new, check by querying for block table
  if (isNew === undefined) {
    try {
      await stream.query('SELECT 1 FROM block LIMIT 1', [])
      // Block table exists, stream is not new
      isNew = false
      console.log('Block table exists, stream is not new')
    } catch (error: any) {
      if (error.message && error.message.includes('does not exist')) {
        // Block table doesn't exist, stream is new
        isNew = true
        console.log('Block table does not exist, stream is new')
      } else {
        // Some other error, re-throw
        throw error
      }
    }
  }
  
  // For new streams, run stream migrations to add tables to the stream
  if (isNew) {
    console.log('Running stream migrations for new stream')
    await streamMigrations(stream)
  }
  
  // Always run local migrations (these are never in the stream)
  console.log('Running local migrations')
  await localMigrations(stream.local())
}
