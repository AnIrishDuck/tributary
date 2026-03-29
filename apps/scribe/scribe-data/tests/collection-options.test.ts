import { test, expect, describe } from 'vitest'
import { TributaryClient, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import { createHomeLibrary, ensureCollectionOptions } from '../src/library.js'
import { getCollectionOptions, setCollectionOptions, getLibrary, createCollection } from '../src/collection.js'
import { localMigrations } from '../src/migrations.js'

function makeClient(server?: FakeServer) {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  return { client, server: s }
}

function countBlobsForStream(server: FakeServer, stream: { getId(): string }): number {
  return server.getAllBlobs().filter(b => b.pubkey === stream.getId()).length
}

/**
 * Create a stream with the old schema (no `options` column on collection).
 * Mirrors the pattern in library-plugins.test.ts for pre-migration testing.
 */
async function createOldSchemaStream(server: FakeServer) {
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server, db: pglite })
  const keyPair = nacl.sign.keyPair()
  const stream = await client.addWriteKey('scribe', keyPair.secretKey)

  // Old schema: block + collection + library_plugins, but NO options column
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
  await stream.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS collection_one_root
    ON collection ((1)) WHERE parent_collection_uuid IS NULL
  `)
  await stream.exec(`
    CREATE TABLE IF NOT EXISTS library_plugins (
      plugin_url TEXT NOT NULL PRIMARY KEY,
      config_json TEXT NOT NULL DEFAULT '{}',
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `)
  await localMigrations(stream.local())

  // Create a root collection so we have something to test against
  await stream.exec(
    `INSERT INTO collection (collection_uuid, title, parent_collection_uuid, insert_datetime, inserter, linked_stream_id, linked_stream_key, slug)
     VALUES ($1, $2, NULL, $3, $4, NULL, NULL, $5)`,
    ['root-uuid', 'My Library', new Date().toISOString(), 'user', 'my-library']
  )

  return { client, stream }
}

describe('collection options', () => {
  test('new library collections have empty options by default', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const library = await getLibrary(stream)
    expect(library).not.toBeNull()

    const options = await getCollectionOptions(stream, library!.collection_uuid)
    expect(options).toEqual({})
  })

  test('set and retrieve options on a collection', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const library = await getLibrary(stream)
    const collection = await createCollection(stream, {
      title: 'Recipes',
      parent_collection_uuid: library!.collection_uuid,
      inserter: 'user',
    })

    await setCollectionOptions(stream, collection.collection_uuid, { view: 'grid', pinned: true })

    const options = await getCollectionOptions(stream, collection.collection_uuid)
    expect(options).toEqual({ view: 'grid', pinned: true })
  })

  test('options are JSON round-tripped correctly', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const library = await getLibrary(stream)
    const nested = { theme: 'dark', layout: { columns: 3, spacing: 'wide' }, tags: ['a', 'b'] }
    await setCollectionOptions(stream, library!.collection_uuid, nested)

    const options = await getCollectionOptions(stream, library!.collection_uuid)
    expect(options).toEqual(nested)
  })

  test('replacing options overwrites previous value', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const library = await getLibrary(stream)
    await setCollectionOptions(stream, library!.collection_uuid, { first: true })
    await setCollectionOptions(stream, library!.collection_uuid, { second: true })

    const options = await getCollectionOptions(stream, library!.collection_uuid)
    expect(options).toEqual({ second: true })
  })

  test('getCollectionOptions returns {} for nonexistent collection', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const options = await getCollectionOptions(stream, 'nonexistent-uuid')
    expect(options).toEqual({})
  })

  test('getCollectionOptions returns {} on pre-migration library (non-view-blocking)', async () => {
    const server = new FakeServer()
    const { stream } = await createOldSchemaStream(server)

    // The options column does not exist, but getCollectionOptions should NOT throw.
    // It returns {} so that callers can render without waiting for the migration.
    const options = await getCollectionOptions(stream, 'root-uuid')
    expect(options).toEqual({})
  })

  test('getCollectionOptions does not create blobs on pre-migration library', async () => {
    const server = new FakeServer()
    const { stream } = await createOldSchemaStream(server)

    const blobCountBefore = countBlobsForStream(server, stream)

    await getCollectionOptions(stream, 'root-uuid')
    await getCollectionOptions(stream, 'root-uuid')

    const blobCountAfter = countBlobsForStream(server, stream)
    expect(blobCountAfter).toBe(blobCountBefore)
  })

  test('setCollectionOptions throws on pre-migration library', async () => {
    const server = new FakeServer()
    const { stream } = await createOldSchemaStream(server)

    // setCollectionOptions must error when the options column is missing.
    // The caller is responsible for running ensureCollectionOptions first.
    await expect(
      setCollectionOptions(stream, 'root-uuid', { foo: 'bar' })
    ).rejects.toThrow()
  })

  test('ensureCollectionOptions creates the column on pre-migration library', async () => {
    const server = new FakeServer()
    const { stream } = await createOldSchemaStream(server)

    const blobCountBefore = countBlobsForStream(server, stream)

    // After ensureCollectionOptions, get and set should work
    await ensureCollectionOptions(stream)

    // ensureCollectionOptions created exactly one blob
    const blobCountAfter = countBlobsForStream(server, stream)
    expect(blobCountAfter).toBe(blobCountBefore + 1)

    const options = await getCollectionOptions(stream, 'root-uuid')
    expect(options).toEqual({})

    await setCollectionOptions(stream, 'root-uuid', { migrated: true })
    const updated = await getCollectionOptions(stream, 'root-uuid')
    expect(updated).toEqual({ migrated: true })
  })

  test('ensureCollectionOptions is idempotent (no extra blobs on second call)', async () => {
    const server = new FakeServer()
    const { stream } = await createOldSchemaStream(server)

    await ensureCollectionOptions(stream)
    const blobCountAfterFirst = countBlobsForStream(server, stream)

    // Second call should not create another blob
    await ensureCollectionOptions(stream)
    const blobCountAfterSecond = countBlobsForStream(server, stream)
    expect(blobCountAfterSecond).toBe(blobCountAfterFirst)
  })

  test('getCollectionOptions does not create redundant blobs on repeated calls', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const blobCountAfterCreate = countBlobsForStream(server, stream)

    const library = await getLibrary(stream)
    await getCollectionOptions(stream, library!.collection_uuid)
    await getCollectionOptions(stream, library!.collection_uuid)
    await getCollectionOptions(stream, library!.collection_uuid)

    const blobCountAfterReads = countBlobsForStream(server, stream)
    expect(blobCountAfterReads).toBe(blobCountAfterCreate)
  })
})
