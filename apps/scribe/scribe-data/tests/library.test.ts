import { test, expect, describe } from 'vitest'
import { createTestDB } from './test-utils.js'
import { initializeLibrary } from '../src/library.js'
import { getLibrary } from '../src/collection.js'
import { createNote } from '../src/note.js'

describe('initializeLibrary', () => {
  test('should run migrations and create library with the given name', async () => {
    const { stream } = await createTestDB()

    await initializeLibrary(stream, 'My Notes')

    // Library should exist with the given name
    const root = await getLibrary(stream)
    expect(root).toBeDefined()
    expect(root?.title).toBe('My Notes')
    expect(root?.parent_collection_uuid).toBeNull()
    expect(root?.inserter).toBe('user')
  })

  test('should create working tables that accept notes', async () => {
    const { stream } = await createTestDB()

    await initializeLibrary(stream, 'Test Library')

    // Should be able to create notes after initialization
    const note = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Hello\n\nFirst note.',
      inserter: 'test-user'
    })

    expect(note).toBeDefined()
    expect(note.block_uuid).toBeDefined()
  })

  test('should create local tables for indexing', async () => {
    const { stream } = await createTestDB()

    await initializeLibrary(stream, 'Test Library')

    // Local tables should exist — verify by inserting into indexed_block
    const local = stream.local()
    await local.exec(`
      INSERT INTO indexed_block (block_uuid, version_uuid, indexed, last_indexed_at)
      VALUES ('test-uuid', 'test-version', true, '2026-01-01T00:00:00Z')
    `)

    const result = await local.query('SELECT * FROM indexed_block WHERE block_uuid = $1', ['test-uuid'])
    expect(result.rows).toHaveLength(1)
  })
})
