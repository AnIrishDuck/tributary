import { test, expect, describe } from 'vitest'
import { createTestDB } from './test-utils.js'
import { initializeStream } from '../src/stream.js'
import { getRootCollection } from '../src/collection.js'
import { createBlock } from '../src/block.js'

describe('initializeStream', () => {
  test('should run migrations and create root collection with the given name', async () => {
    const { stream } = await createTestDB()

    await initializeStream(stream, 'My Notes')

    // Root collection should exist with the given name
    const root = await getRootCollection(stream)
    expect(root).toBeDefined()
    expect(root?.title).toBe('My Notes')
    expect(root?.parent_collection_uuid).toBeNull()
    expect(root?.inserter).toBe('user')
  })

  test('should create working tables that accept blocks', async () => {
    const { stream } = await createTestDB()

    await initializeStream(stream, 'Test Stream')

    // Should be able to create blocks after initialization
    const block = await createBlock(stream, {
      block_type: 'scribe/markdown',
      body: '# Hello\n\nFirst block.',
      inserter: 'test-user'
    })

    expect(block).toBeDefined()
    expect(block.block_uuid).toBeDefined()
  })

  test('should create local tables for indexing', async () => {
    const { stream } = await createTestDB()

    await initializeStream(stream, 'Test Stream')

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
