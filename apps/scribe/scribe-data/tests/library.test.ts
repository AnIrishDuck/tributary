import { test, expect, describe } from 'vitest'
import { TributaryClient, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { createHomeLibrary, createLibrary, importLibrary } from '../src/library.js'
import { getLibrary, getLinkedLibraries } from '../src/collection.js'
import { createNote } from '../src/note.js'

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
