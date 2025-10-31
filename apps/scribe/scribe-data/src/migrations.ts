import { PGlite } from '@electric-sql/pglite'
import { TributaryStream, TributaryLocal } from 'tributary-client'

/**
 * Migration to create the block table for the scribe app with proper UUID constraints
 */
export async function up(syncedDb: TributaryStream, localDb: TributaryLocal): Promise<void> {
  // Create the block table
  await syncedDb.exec(`
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

  await syncedDb.exec(`
    ALTER TABLE block 
    ADD CONSTRAINT block_uuid_version_uuid_unique 
    UNIQUE (block_uuid, version_uuid)
  `)

  // Create the indexed_block table for tracking indexing status (non-synchronized)
  await localDb.exec(`
    CREATE TABLE IF NOT EXISTS indexed_block (
      block_uuid TEXT NOT NULL PRIMARY KEY,
      version_uuid TEXT NOT NULL,
      indexed BOOLEAN NOT NULL,
      last_indexed_at TEXT NOT NULL
    )
  `)

  // Create the block_slug table for storing block slugs (non-synchronized)
  await localDb.exec(`
    CREATE TABLE IF NOT EXISTS block_slug (
      block_uuid TEXT NOT NULL PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    )
  `)

  // Create the authoritative_version table for mapping block UUIDs to their authoritative versions (non-synchronized)
  await localDb.exec(`
    CREATE TABLE IF NOT EXISTS authoritative_version (
      block_uuid TEXT NOT NULL PRIMARY KEY,
      version_uuid TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    )
  `)

  // Create the block_tag table for storing block tags (non-synchronized)
  await localDb.exec(`
    CREATE TABLE IF NOT EXISTS block_tag (
      block_uuid TEXT NOT NULL,
      tag TEXT NOT NULL,
      indexed_at TEXT NOT NULL,
      PRIMARY KEY (block_uuid, tag)
    )
  `)
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
