import { Kysely } from 'kysely'

/**
 * Migration to create the block table for the scribe app with proper UUID constraints
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('block')
    .addColumn('block_uuid', 'text', (col) => col.notNull())
    .addColumn('block_type', 'text', (col) => col.notNull())
    .addColumn('version_uuid', 'text', (col) => col.notNull().primaryKey())
    .addColumn('prior_version_uuid', 'text')
    .addColumn('insert_datetime', 'text', (col) => col.notNull())
    .addColumn('inserter', 'text', (col) => col.notNull())
    .addColumn('body', 'text', (col) => col.notNull())
    .addUniqueConstraint('block_uuid_version_uuid_unique', ['block_uuid', 'version_uuid'])
    .execute()

  // Create the indexed_block table for tracking indexing status (non-synchronized)
  await db.schema
    .createTable('indexed_block')
    .addColumn('block_uuid', 'text', (col) => col.notNull().primaryKey())
    .addColumn('version_uuid', 'text', (col) => col.notNull())
    .addColumn('indexed', 'boolean', (col) => col.notNull())
    .addColumn('last_indexed_at', 'text', (col) => col.notNull())
    .execute()

  // Create the block_slug table for storing block slugs (non-synchronized)
  await db.schema
    .createTable('block_slug')
    .addColumn('block_uuid', 'text', (col) => col.notNull().primaryKey())
    .addColumn('slug', 'text', (col) => col.notNull())
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('indexed_at', 'text', (col) => col.notNull())
    .execute()

  // Create the authoritative_version table for mapping block UUIDs to their authoritative versions (non-synchronized)
  await db.schema
    .createTable('authoritative_version')
    .addColumn('block_uuid', 'text', (col) => col.notNull().primaryKey())
    .addColumn('version_uuid', 'text', (col) => col.notNull())
    .addColumn('indexed_at', 'text', (col) => col.notNull())
    .execute()
}

/**
 * Migration to drop the block table
 */
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('authoritative_version').execute()
  await db.schema.dropTable('block_slug').execute()
  await db.schema.dropTable('indexed_block').execute()
  await db.schema.dropTable('block').execute()
}
