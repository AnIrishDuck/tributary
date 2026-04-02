import { test, expect, describe } from 'vitest'
import { TributaryClient, FakeServer, hasMigration } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import { createHomeLibrary, ensureSyncedMigrations } from '../src/library.js'
import { getCollectionOptions, setCollectionOptions, getLibrary, createCollection, getCollectionByUuid } from '../src/collection.js'
import { syncedMigrations, localMigrations, addCollectionOptions } from '../src/migrations.js'

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
 * Create a stream at the pre-options schema using migrate()'s `before` option
 * to stop just before the add_collection_options migration.
 */
async function createPreOptionsStream(server: FakeServer) {
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server, db: pglite })
  const keyPair = nacl.sign.keyPair()
  const stream = await client.addWriteKey('scribe', keyPair.secretKey)

  // Run the cowboy migrations (block, collection, plugins) then the formal
  // migration list stopping before add_collection_options.
  await syncedMigrations(stream, { before: addCollectionOptions.name })
  await localMigrations(stream.local())

  // Create a root collection so we have something to test against
  await createCollection(stream, {
    collection_uuid: 'root-uuid',
    title: 'My Library',
    inserter: 'user',
    slug: 'my-library',
  })

  return { client, stream }
}

describe('collection options', () => {
  test('new library collections have empty options by default', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const library = await getLibrary(stream)
    expect(library).not.toBeNull()

    // getCollectionByUuid (SELECT *) should include options after migration
    const fetched = await getCollectionByUuid(stream, library!.collection_uuid)
    expect(fetched).not.toBeNull()
    expect(fetched!.options).toBe('{}')

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
    const { stream } = await createPreOptionsStream(server)

    // getCollectionByUuid (SELECT *) should work but options is undefined
    // because the column doesn't exist yet
    const fetched = await getCollectionByUuid(stream, 'root-uuid')
    expect(fetched).not.toBeNull()
    expect(fetched!.options).toBeUndefined()

    // The options column does not exist, but getCollectionOptions should NOT throw.
    // It returns {} so that callers can render without waiting for the migration.
    const options = await getCollectionOptions(stream, 'root-uuid')
    expect(options).toEqual({})
  })

  test('getCollectionOptions does not create blobs on pre-migration library', async () => {
    const server = new FakeServer()
    const { stream } = await createPreOptionsStream(server)

    const blobCountBefore = countBlobsForStream(server, stream)

    await getCollectionOptions(stream, 'root-uuid')
    await getCollectionOptions(stream, 'root-uuid')

    const blobCountAfter = countBlobsForStream(server, stream)
    expect(blobCountAfter).toBe(blobCountBefore)
  })

  test('setCollectionOptions throws on pre-migration library', async () => {
    const server = new FakeServer()
    const { stream } = await createPreOptionsStream(server)

    // setCollectionOptions must error when the options column is missing.
    // The caller is responsible for running ensureSyncedMigrations first.
    await expect(
      setCollectionOptions(stream, 'root-uuid', { foo: 'bar' })
    ).rejects.toThrow()
  })

  test('ensureSyncedMigrations adds the options column on pre-migration library', async () => {
    const server = new FakeServer()
    const { stream } = await createPreOptionsStream(server)

    expect(await hasMigration(stream, addCollectionOptions.name)).toBe(false)

    await ensureSyncedMigrations(stream)

    expect(await hasMigration(stream, addCollectionOptions.name)).toBe(true)

    const options = await getCollectionOptions(stream, 'root-uuid')
    expect(options).toEqual({})

    await setCollectionOptions(stream, 'root-uuid', { migrated: true })
    const updated = await getCollectionOptions(stream, 'root-uuid')
    expect(updated).toEqual({ migrated: true })
  })

  test('ensureSyncedMigrations does not re-run the migration on second call', async () => {
    const server = new FakeServer()
    const { stream } = await createPreOptionsStream(server)

    await ensureSyncedMigrations(stream)
    expect(await hasMigration(stream, addCollectionOptions.name)).toBe(true)

    // Second call is safe — migration is already tracked so up() is skipped
    await ensureSyncedMigrations(stream)
    expect(await hasMigration(stream, addCollectionOptions.name)).toBe(true)
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
