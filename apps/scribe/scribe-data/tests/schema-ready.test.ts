import { describe, it, expect, beforeEach } from 'vitest'
import { TributaryClient, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import { syncedMigrations, localMigrations, schemaReady, migrateAddPlugins } from '../src/migrations'
import { ensurePluginTable } from '../src/library'

function makeClient(server?: FakeServer) {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  return { client, server: s }
}

describe('schemaReady', () => {
  it('returns false when no migrations have been run', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    const ready = await schemaReady(stream)
    expect(ready).toBe(false)
  })

  it('returns false after only syncedMigrations (local tables missing)', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    await syncedMigrations(stream)

    const ready = await schemaReady(stream)
    expect(ready).toBe(false)
  })

  it('returns true after full migrations (synced + local)', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    await syncedMigrations(stream)
    await localMigrations(stream.local())

    const ready = await schemaReady(stream)
    expect(ready).toBe(true)
  })

  it('returns false when only local migrations have been run (no synced tables)', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    await localMigrations(stream.local())

    const ready = await schemaReady(stream)
    expect(ready).toBe(false)
  })

  it('works via TributaryLocal (stream.local())', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    // Before migrations — local DB also cannot see synced tables
    const localDb = stream.local()
    expect(await schemaReady(localDb)).toBe(false)

    // After only synced migrations — local tables still missing
    await syncedMigrations(stream)
    expect(await schemaReady(localDb)).toBe(false)

    // After both synced + local migrations — all tables present
    await localMigrations(localDb)
    expect(await schemaReady(localDb)).toBe(true)
  })

  it('returns false when library_plugins table is missing (pre-plugin library)', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    // Create only block + collection (old schema without library_plugins or archived)
    await stream.exec(`
      CREATE TABLE IF NOT EXISTS block (
        block_uuid TEXT NOT NULL, block_type TEXT NOT NULL,
        version_uuid TEXT NOT NULL PRIMARY KEY, prior_version_uuid TEXT,
        insert_datetime TEXT NOT NULL, inserter TEXT NOT NULL,
        body TEXT NOT NULL, collection_id TEXT, slug TEXT NOT NULL,
        archived BOOLEAN NOT NULL DEFAULT FALSE
      )
    `)
    await stream.exec(`
      CREATE TABLE IF NOT EXISTS collection (
        collection_uuid TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL,
        parent_collection_uuid TEXT, insert_datetime TEXT NOT NULL,
        inserter TEXT NOT NULL, linked_stream_id TEXT,
        linked_stream_key TEXT, slug TEXT NOT NULL,
        archived BOOLEAN NOT NULL DEFAULT FALSE
      )
    `)
    await localMigrations(stream.local())

    // schema not ready because library_plugins is missing
    expect(await schemaReady(stream)).toBe(false)

    // After adding the plugins table, schema is ready
    await migrateAddPlugins(stream)
    expect(await schemaReady(stream)).toBe(true)
  })

  it('ensurePluginTable creates table only when missing and produces exactly one blob', async () => {
    const server = new FakeServer()
    const pglite = new PGlite('memory://')
    const client = new TributaryClient({ server, db: pglite })
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    // Old schema without library_plugins
    await stream.exec(`
      CREATE TABLE IF NOT EXISTS block (
        block_uuid TEXT NOT NULL, block_type TEXT NOT NULL,
        version_uuid TEXT NOT NULL PRIMARY KEY, prior_version_uuid TEXT,
        insert_datetime TEXT NOT NULL, inserter TEXT NOT NULL,
        body TEXT NOT NULL, collection_id TEXT, slug TEXT NOT NULL,
        archived BOOLEAN NOT NULL DEFAULT FALSE
      )
    `)
    await stream.exec(`
      CREATE TABLE IF NOT EXISTS collection (
        collection_uuid TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL,
        parent_collection_uuid TEXT, insert_datetime TEXT NOT NULL,
        inserter TEXT NOT NULL, linked_stream_id TEXT,
        linked_stream_key TEXT, slug TEXT NOT NULL,
        archived BOOLEAN NOT NULL DEFAULT FALSE
      )
    `)

    const blobsBefore = server.getAllBlobs().filter(b => b.pubkey === stream.getId()).length

    // First call creates the table (one blob)
    await ensurePluginTable(stream)
    const blobsAfterFirst = server.getAllBlobs().filter(b => b.pubkey === stream.getId()).length
    expect(blobsAfterFirst).toBe(blobsBefore + 1)

    // Second call is a no-op (table already exists)
    await ensurePluginTable(stream)
    const blobsAfterSecond = server.getAllBlobs().filter(b => b.pubkey === stream.getId()).length
    expect(blobsAfterSecond).toBe(blobsAfterFirst)
  })

  it('returns false when archived column is missing (pre-archived-migration)', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    // Create tables without the archived column
    await stream.exec(`
      CREATE TABLE IF NOT EXISTS block (
        block_uuid TEXT NOT NULL, block_type TEXT NOT NULL,
        version_uuid TEXT NOT NULL PRIMARY KEY, prior_version_uuid TEXT,
        insert_datetime TEXT NOT NULL, inserter TEXT NOT NULL,
        body TEXT NOT NULL, collection_id TEXT, slug TEXT NOT NULL
      )
    `)
    await stream.exec(`
      CREATE TABLE IF NOT EXISTS collection (
        collection_uuid TEXT NOT NULL PRIMARY KEY, title TEXT NOT NULL,
        parent_collection_uuid TEXT, insert_datetime TEXT NOT NULL,
        inserter TEXT NOT NULL, linked_stream_id TEXT,
        linked_stream_key TEXT, slug TEXT NOT NULL
      )
    `)
    await migrateAddPlugins(stream)
    await localMigrations(stream.local())

    // Schema not ready because archived column is missing
    expect(await schemaReady(stream)).toBe(false)

    // After adding the archived column, schema is ready
    await stream.exec(`ALTER TABLE block ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE`)
    await stream.exec(`ALTER TABLE collection ADD COLUMN archived BOOLEAN NOT NULL DEFAULT FALSE`)
    expect(await schemaReady(stream)).toBe(true)
  })

  it('returns true on a fresh client after syncing and running local migrations', async () => {
    const server = new FakeServer()

    // Client 1: create library with full migrations
    const { client: client1 } = makeClient(server)
    const keyPair = nacl.sign.keyPair()
    const stream1 = await client1.addWriteKey('scribe', keyPair.secretKey)
    await syncedMigrations(stream1)
    await stream1.sync(1000)

    // Client 2: sync the same library from scratch
    const { client: client2 } = makeClient(server)
    const stream2 = await client2.addWriteKey('scribe', keyPair.secretKey)

    // Before sync, schema should not be ready
    expect(await schemaReady(stream2)).toBe(false)

    // After sync only — synced tables arrive but local tables are missing
    await stream2.sync(1000)
    expect(await schemaReady(stream2)).toBe(false)

    // After local migrations — all tables present
    await localMigrations(stream2.local())
    expect(await schemaReady(stream2)).toBe(true)
  })
})
