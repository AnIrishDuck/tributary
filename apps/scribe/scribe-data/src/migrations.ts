import { Kysely } from 'kysely'

/**
 * Migration to create the block table for the scribe app with proper UUID constraints
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('block')
    .addColumn('block_uuid', 'uuid', (col) => col.notNull())
    .addColumn('block_type', 'text', (col) => col.notNull())
    .addColumn('version_uuid', 'uuid', (col) => col.notNull().primaryKey())
    .addColumn('prior_version_uuid', 'uuid')
    .addColumn('insert_datetime', 'timestamptz', (col) => col.notNull())
    .addColumn('inserter', 'text', (col) => col.notNull())
    .addColumn('body', 'text', (col) => col.notNull())
    .addUniqueConstraint('block_uuid_version_uuid_unique', ['block_uuid', 'version_uuid'])
    .execute()
}

/**
 * Migration to drop the block table
 */
export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('block').execute()
}
