import { test, expect, describe } from 'vitest'
import { TributaryClient, FakeServer, estimateStreamStorageBytes } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import {
  estimateLibraryStorage,
  estimateAllLibraryStorage,
  estimateQuota,
} from '../src/storage.js'
import { createHomeLibrary, createLibrary } from '../src/library.js'
import { createNote } from '../src/note.js'

function makeClient(server?: FakeServer) {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  return { client, server: s, pglite }
}

describe('estimateLibraryStorage', () => {
  test('returns storage estimate with note count for a library', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const keyPair = nacl.sign.keyPair()

    const { stream, streamId } = await createHomeLibrary(client, 'My Library', keyPair)

    // Create some notes
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# First note\n\nSome content here.',
      inserter: 'user',
    })
    await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Second note\n\nMore content.',
      inserter: 'user',
    })

    const estimate = await estimateLibraryStorage(stream)
    expect(estimate.streamId).toBe(streamId)
    expect(estimate.estimatedBytes).toBeGreaterThan(0)
    expect(estimate.noteCount).toBe(2)
  })
})

describe('estimateAllLibraryStorage', () => {
  test('returns storage estimates for all streams with titles', async () => {
    const server = new FakeServer()
    const { client, pglite } = makeClient(server)
    const keyPair = nacl.sign.keyPair()

    const { stream: homeStream, streamId: homeStreamId } =
      await createHomeLibrary(client, 'Home Library', keyPair)

    // Create a linked library
    const { streamId: linkedId } = await createLibrary(
      client,
      'Work Notes',
      homeStream
    )

    // Add some notes to both libraries
    await createNote(homeStream, {
      block_type: 'scribe/markdown',
      body: '# Home note',
      inserter: 'user',
    })

    const linkedStream = await client.get('scribe', linkedId)
    if (linkedStream) {
      await createNote(linkedStream, {
        block_type: 'scribe/markdown',
        body: '# Work note',
        inserter: 'user',
      })
    }

    const result = await estimateAllLibraryStorage(pglite, homeStreamId)

    // Should have at least 2 streams (home + linked)
    expect(result.libraries.length).toBeGreaterThanOrEqual(2)
    expect(result.totalBytes).toBeGreaterThan(0)

    // Home library should be identified by title
    const home = result.libraries.find((l) => l.streamId === homeStreamId)
    expect(home).toBeDefined()
    expect(home!.title).toBe('Home Library')
    expect(home!.noteCount).toBeGreaterThanOrEqual(1)

    // Linked library should be identified by title
    const linked = result.libraries.find((l) => l.streamId === linkedId)
    expect(linked).toBeDefined()
    expect(linked!.title).toBe('Work Notes')
  })

  test('falls back to stream ID when title is unknown', async () => {
    const pglite = new PGlite('memory://')

    // Manually set up tributary schema with a stream that has no library title
    await pglite.exec('CREATE SCHEMA IF NOT EXISTS tributary')
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS tributary.streams (
        id TEXT PRIMARY KEY,
        schema_id TEXT UNIQUE NOT NULL,
        read_key BYTEA NOT NULL,
        write_key BYTEA,
        last_sync_index INTEGER
      )
    `)
    await pglite.query(
      `INSERT INTO tributary.streams (id, schema_id, read_key)
       VALUES ($1, $2, $3)`,
      ['unknown-stream', 'orphanschema', new Uint8Array(32)]
    )

    // Create the stream's schema with a block table
    await pglite.exec('CREATE SCHEMA IF NOT EXISTS "scribe_orphanschema"')
    await pglite.exec(`
      CREATE TABLE "scribe_orphanschema".block (
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

    const result = await estimateAllLibraryStorage(pglite, 'nonexistent-home')
    expect(result.libraries).toHaveLength(1)
    // Falls back to stream ID as title
    expect(result.libraries[0].title).toBe('unknown-stream')
  })

  test('returns empty array when no streams exist', async () => {
    const pglite = new PGlite('memory://')
    await pglite.exec('CREATE SCHEMA IF NOT EXISTS tributary')
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS tributary.streams (
        id TEXT PRIMARY KEY,
        schema_id TEXT UNIQUE NOT NULL,
        read_key BYTEA NOT NULL,
        write_key BYTEA,
        last_sync_index INTEGER
      )
    `)

    const result = await estimateAllLibraryStorage(pglite, 'no-home')
    expect(result.libraries).toEqual([])
    expect(result.totalBytes).toBe(0)
  })
})

describe('estimateQuota', () => {
  test('returns null when navigator.storage is unavailable', async () => {
    // In Node/vitest, navigator.storage is not available
    const result = await estimateQuota()
    expect(result).toBeNull()
  })
})

describe('estimateStreamStorageBytes (re-exported from tributary-client)', () => {
  test('estimate grows proportionally with data', async () => {
    const pglite = new PGlite('memory://')

    const smallSchema = 'scribe_small'
    const largeSchema = 'scribe_large'

    for (const schema of [smallSchema, largeSchema]) {
      await pglite.exec(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
      await pglite.exec(`
        CREATE TABLE "${schema}".block (
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
    }

    for (let i = 0; i < 5; i++) {
      await pglite.query(
        `INSERT INTO "${smallSchema}".block
         (block_uuid, block_type, version_uuid, insert_datetime, inserter, body, slug)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [`note-${i}`, 'scribe/markdown', `v-${i}`, new Date().toISOString(), 'user', 'Short.', `n-${i}`]
      )
    }

    const longBody = '# Long Note\n\n' + 'Lorem ipsum dolor sit amet. '.repeat(100)
    for (let i = 0; i < 50; i++) {
      await pglite.query(
        `INSERT INTO "${largeSchema}".block
         (block_uuid, block_type, version_uuid, insert_datetime, inserter, body, slug)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [`note-${i}`, 'scribe/markdown', `v-${i}`, new Date().toISOString(), 'user', longBody, `n-${i}`]
      )
    }

    const small = await estimateStreamStorageBytes(pglite, smallSchema)
    const large = await estimateStreamStorageBytes(pglite, largeSchema)

    expect(large.estimatedBytes).toBeGreaterThan(small.estimatedBytes)
  })
})
