import { test, expect, describe } from 'vitest'
import { FakeServer, estimateStreamStorageBytes } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import {
  estimateLibraryStorage,
  estimateQuota,
} from '../src/storage.js'
import { createHomeLibrary } from '../src/library.js'
import { createNote } from '../src/note.js'
import { TributaryClient } from 'tributary-client'

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
