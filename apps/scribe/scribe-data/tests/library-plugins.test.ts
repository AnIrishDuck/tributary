import { test, expect, describe } from 'vitest'
import { TributaryClient, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { createHomeLibrary, getLibraryPlugins, setLibraryPlugins } from '../src/library.js'
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

describe('library plugin storage', () => {
  test('new library has empty plugins', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const plugins = await getLibraryPlugins(stream)
    expect(plugins).toEqual([])
  })

  test('getLibraryPlugins does not create redundant blobs on repeated calls', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const blobCountAfterCreate = countBlobsForStream(server, stream)

    // Call getLibraryPlugins multiple times — should NOT create any new blobs
    await getLibraryPlugins(stream)
    await getLibraryPlugins(stream)
    await getLibraryPlugins(stream)

    const blobCountAfterReads = countBlobsForStream(server, stream)
    expect(blobCountAfterReads).toBe(blobCountAfterCreate)
  })

  test('getLibraryPlugins creates table and does not create redundant blobs on pre-plugin library', async () => {
    // Simulate a library created before the plugin system existed:
    // create a stream with only block + collection tables (no library_plugins)
    const server = new FakeServer()
    const pglite = new PGlite('memory://')
    const client = new TributaryClient({ server, db: pglite })
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    // Manually create only block and collection tables (old schema, no library_plugins)
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
    await localMigrations(stream.local())

    const blobCountBefore = countBlobsForStream(server, stream)

    // First call should create the table (one blob)
    const plugins1 = await getLibraryPlugins(stream)
    expect(plugins1).toEqual([])
    const blobCountAfterFirst = countBlobsForStream(server, stream)
    expect(blobCountAfterFirst).toBe(blobCountBefore + 1)

    // Second call should NOT create any blobs (table already exists)
    await getLibraryPlugins(stream)
    const blobCountAfterSecond = countBlobsForStream(server, stream)
    expect(blobCountAfterSecond).toBe(blobCountAfterFirst)
  })

  test('set and retrieve plugin entries', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/plugin-a.js', config_json: '{"mode":"always"}' },
      { plugin_url: 'https://example.com/plugin-b.js' },
    ])

    const plugins = await getLibraryPlugins(stream)
    expect(plugins).toHaveLength(2)
    expect(plugins[0].plugin_url).toBe('https://example.com/plugin-a.js')
    expect(plugins[0].config_json).toBe('{"mode":"always"}')
    expect(plugins[0].sort_order).toBe(0)
    expect(plugins[1].plugin_url).toBe('https://example.com/plugin-b.js')
    expect(plugins[1].config_json).toBe('{}')
    expect(plugins[1].sort_order).toBe(1)
  })

  test('config is round-tripped correctly as JSON', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const config = { theme: 'dark', size: '16', nested: '{"a":1}' }
    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/plugin.js', config_json: JSON.stringify(config) },
    ])

    const plugins = await getLibraryPlugins(stream)
    expect(plugins).toHaveLength(1)
    const parsed = JSON.parse(plugins[0].config_json)
    expect(parsed).toEqual(config)
  })

  test('replacing plugins list replaces all entries', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    // Set initial plugins
    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/old-a.js' },
      { plugin_url: 'https://example.com/old-b.js' },
    ])

    // Replace with new plugins
    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/new-x.js', config_json: '{"key":"val"}' },
    ])

    const plugins = await getLibraryPlugins(stream)
    expect(plugins).toHaveLength(1)
    expect(plugins[0].plugin_url).toBe('https://example.com/new-x.js')
    expect(plugins[0].config_json).toBe('{"key":"val"}')
    expect(plugins[0].sort_order).toBe(0)
  })

  test('plugin order is preserved via sort_order', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/first.js' },
      { plugin_url: 'https://example.com/second.js' },
      { plugin_url: 'https://example.com/third.js' },
    ])

    const plugins = await getLibraryPlugins(stream)
    expect(plugins).toHaveLength(3)
    expect(plugins[0].plugin_url).toBe('https://example.com/first.js')
    expect(plugins[0].sort_order).toBe(0)
    expect(plugins[1].plugin_url).toBe('https://example.com/second.js')
    expect(plugins[1].sort_order).toBe(1)
    expect(plugins[2].plugin_url).toBe('https://example.com/third.js')
    expect(plugins[2].sort_order).toBe(2)
  })
})
