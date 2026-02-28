import { test, expect, describe } from 'vitest'
import { TributaryClient, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { createHomeLibrary, createLibrary, importLibrary, upsertLinkedLibrary, getCachedLinkedLibraries, seedLinkedLibrariesCache } from '../src/library.js'
import { getLibrary, getLinkedLibraries } from '../src/collection.js'
import { createNote } from '../src/note.js'
import { localMigrations } from '../src/migrations.js'

function makeClient(server?: FakeServer) {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  return { client, server: s }
}

describe('createHomeLibrary', () => {
  test('should create a home library with root collection and set home stream', async () => {
    const { client, server } = makeClient()
    const keyPair = nacl.sign.keyPair()

    const { stream, streamId } = await createHomeLibrary(client, 'My Library', keyPair)

    // Root collection should exist
    const root = await getLibrary(stream)
    expect(root).toBeDefined()
    expect(root?.title).toBe('My Library')
    expect(root?.parent_collection_uuid).toBeNull()

    // Home stream should be set
    const homeStreamId = await client.getHomeStream()
    expect(homeStreamId).toBe(streamId)
  })

  test('should create working tables that accept notes', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()

    const { stream } = await createHomeLibrary(client, 'Test Library', keyPair)

    const note = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Hello\n\nFirst note.',
      inserter: 'test-user'
    })
    expect(note).toBeDefined()
    expect(note.block_uuid).toBeDefined()
  })

  test('should create local tables for indexing', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()

    const { stream } = await createHomeLibrary(client, 'Test Library', keyPair)

    const local = stream.local()
    await local.exec(`
      INSERT INTO indexed_block (block_uuid, version_uuid, indexed, last_indexed_at)
      VALUES ('test-uuid', 'test-version', true, '2026-01-01T00:00:00Z')
    `)
    const result = await local.query('SELECT * FROM indexed_block WHERE block_uuid = $1', ['test-uuid'])
    expect(result.rows).toHaveLength(1)
  })
})

describe('createLibrary', () => {
  test('should create a new library and link it into the home stream', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const homeKeyPair = nacl.sign.keyPair()

    const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)

    const { stream, streamId, privateKeyBase64, prefix } = await createLibrary(client, 'Second Library', homeStream)

    // New library should have a root collection
    const root = await getLibrary(stream)
    expect(root).toBeDefined()
    expect(root?.title).toBe('Second Library')

    // Home library should have a linked collection
    const linked = await getLinkedLibraries(homeStream)
    expect(linked).toHaveLength(1)
    expect(linked[0].title).toBe('Second Library')
    expect(linked[0].linked_stream_id).toBe(streamId)
    expect(linked[0].linked_stream_key).toBe(privateKeyBase64)

    // Prefix should be correct
    expect(prefix).toBe(`pk/${streamId}`)
  })
})

describe('importLibrary', () => {
  test('should import an existing library and create local tables', async () => {
    const server = new FakeServer()

    // Create a library on one client
    const { client: client1 } = makeClient(server)
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client1, 'Home', homeKeyPair)
    const { privateKeyBase64, streamId: originalStreamId } = await createLibrary(client1, 'Shared', homeStream)

    // Import on a different client
    const { client: client2 } = makeClient(server)
    const { stream, streamId, prefix } = await importLibrary(client2, privateKeyBase64)

    expect(streamId).toBe(originalStreamId)
    expect(prefix).toBe(`pk/${originalStreamId}`)

    // Local tables should exist
    const local = stream.local()
    await local.exec(`
      INSERT INTO indexed_block (block_uuid, version_uuid, indexed, last_indexed_at)
      VALUES ('test-uuid', 'test-version', true, '2026-01-01T00:00:00Z')
    `)
    const result = await local.query('SELECT * FROM indexed_block WHERE block_uuid = $1', ['test-uuid'])
    expect(result.rows).toHaveLength(1)
  })
})

describe('linked library cache', () => {
  test('getCachedLinkedLibraries returns empty array when no cache entries exist', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', keyPair)

    const cached = await getCachedLinkedLibraries(homeStream.local())
    expect(cached).toEqual([])
  })

  test('upsertLinkedLibrary inserts and can be read back', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', keyPair)
    const homeLocal = homeStream.local()

    await upsertLinkedLibrary(homeLocal, {
      stream_id: 'stream-abc',
      title: 'My Notes',
      last_edited: '2026-01-15T12:00:00Z',
      sync_current_index: 5,
      sync_final_index: 10,
      last_synced_at: '2026-01-15T12:00:00Z',
    })

    const cached = await getCachedLinkedLibraries(homeLocal)
    expect(cached).toHaveLength(1)
    expect(cached[0].stream_id).toBe('stream-abc')
    expect(cached[0].title).toBe('My Notes')
    expect(cached[0].last_edited).toBe('2026-01-15T12:00:00Z')
    expect(cached[0].sync_current_index).toBe(5)
    expect(cached[0].sync_final_index).toBe(10)
    expect(cached[0].last_synced_at).toBe('2026-01-15T12:00:00Z')
    expect(cached[0].cached_at).toBeDefined()
  })

  test('upsertLinkedLibrary updates existing entry on conflict', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', keyPair)
    const homeLocal = homeStream.local()

    await upsertLinkedLibrary(homeLocal, {
      stream_id: 'stream-abc',
      title: 'Old Title',
      last_edited: null,
      sync_current_index: 0,
      sync_final_index: 0,
      last_synced_at: null,
    })

    await upsertLinkedLibrary(homeLocal, {
      stream_id: 'stream-abc',
      title: 'New Title',
      last_edited: '2026-02-01T00:00:00Z',
      sync_current_index: 10,
      sync_final_index: 10,
      last_synced_at: '2026-02-01T00:00:00Z',
    })

    const cached = await getCachedLinkedLibraries(homeLocal)
    expect(cached).toHaveLength(1)
    expect(cached[0].title).toBe('New Title')
    expect(cached[0].last_edited).toBe('2026-02-01T00:00:00Z')
    expect(cached[0].sync_current_index).toBe(10)
  })

  test('getCachedLinkedLibraries returns entries sorted by title', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', keyPair)
    const homeLocal = homeStream.local()

    await upsertLinkedLibrary(homeLocal, {
      stream_id: 'stream-z',
      title: 'Zebra',
      last_edited: null,
      sync_current_index: 0,
      sync_final_index: 0,
      last_synced_at: null,
    })
    await upsertLinkedLibrary(homeLocal, {
      stream_id: 'stream-a',
      title: 'Alpha',
      last_edited: null,
      sync_current_index: 0,
      sync_final_index: 0,
      last_synced_at: null,
    })
    await upsertLinkedLibrary(homeLocal, {
      stream_id: 'stream-m',
      title: 'Middle',
      last_edited: null,
      sync_current_index: 0,
      sync_final_index: 0,
      last_synced_at: null,
    })

    const cached = await getCachedLinkedLibraries(homeLocal)
    expect(cached).toHaveLength(3)
    expect(cached[0].title).toBe('Alpha')
    expect(cached[1].title).toBe('Middle')
    expect(cached[2].title).toBe('Zebra')
  })

  test('seedLinkedLibrariesCache populates cache from home stream collections', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)

    // Create two linked libraries
    const { streamId: id1 } = await createLibrary(client, 'Library A', homeStream)
    const { streamId: id2 } = await createLibrary(client, 'Library B', homeStream)

    const homeLocal = homeStream.local()

    // Cache should be empty before seeding
    const before = await getCachedLinkedLibraries(homeLocal)
    expect(before).toHaveLength(0)

    // Seed the cache
    await seedLinkedLibrariesCache(homeStream, homeLocal)

    const cached = await getCachedLinkedLibraries(homeLocal)
    expect(cached).toHaveLength(2)
    expect(cached[0].title).toBe('Library A')
    expect(cached[0].stream_id).toBe(id1)
    expect(cached[1].title).toBe('Library B')
    expect(cached[1].stream_id).toBe(id2)

    // Seeded entries should have null last_edited and last_synced_at
    expect(cached[0].last_edited).toBeNull()
    expect(cached[0].last_synced_at).toBeNull()
    expect(cached[0].sync_current_index).toBe(0)
    expect(cached[0].sync_final_index).toBe(0)
  })

  test('seedLinkedLibrariesCache does not overwrite existing cache entries', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)

    const { streamId } = await createLibrary(client, 'My Lib', homeStream)

    const homeLocal = homeStream.local()

    // Manually insert a cache entry with sync data
    await upsertLinkedLibrary(homeLocal, {
      stream_id: streamId,
      title: 'My Lib (synced)',
      last_edited: '2026-01-01T00:00:00Z',
      sync_current_index: 50,
      sync_final_index: 50,
      last_synced_at: '2026-01-01T00:00:00Z',
    })

    // Seed should not overwrite the existing entry
    await seedLinkedLibrariesCache(homeStream, homeLocal)

    const cached = await getCachedLinkedLibraries(homeLocal)
    expect(cached).toHaveLength(1)
    expect(cached[0].title).toBe('My Lib (synced)')
    expect(cached[0].sync_current_index).toBe(50)
    expect(cached[0].last_edited).toBe('2026-01-01T00:00:00Z')
  })
})
