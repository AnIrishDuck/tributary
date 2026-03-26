import { describe, test, expect, beforeEach } from 'vitest'
import { createNote, createCollection, indexAll } from 'scribe-data'
import { createTestClientWithStream } from './test-utils'
import { validateLinks } from '../src/utils/linkValidation'

describe('validateLinks', () => {
  let syncedDb: any
  let localDb: any
  let libraryUuid: string

  beforeEach(async () => {
    const result = await createTestClientWithStream('Test Library')
    syncedDb = result.stream
    localDb = syncedDb.local()

    // Get library root UUID
    const libResult = await localDb.query(
      `SELECT collection_uuid FROM collection WHERE parent_collection_uuid IS NULL`,
      []
    )
    libraryUuid = (libResult.rows![0] as any).collection_uuid

    // Create some notes and collections for testing
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# My Note\n\nHello.',
      inserter: 'test-user'
    })

    const cooking = await createCollection(syncedDb, {
      title: 'Cooking',
      parent_collection_uuid: libraryUuid,
      inserter: 'test-user'
    })

    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pasta Recipe\n\nBoil water.',
      inserter: 'test-user',
      collection_id: cooking.collection_uuid
    })

    await indexAll(localDb)
  })

  test('marks existing slug links as ok', async () => {
    const content = '[My Note](my-note)'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.get('my-note')).toBe('ok')
  })

  test('marks missing slug links as broken', async () => {
    const content = '[Missing](nonexistent)'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.get('nonexistent')).toBe('broken')
  })

  test('marks multi-segment slug paths as ok when they exist', async () => {
    const content = '[Pasta](cooking/pasta-recipe)'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.get('cooking/pasta-recipe')).toBe('ok')
  })

  test('marks multi-segment slug paths as broken when missing', async () => {
    const content = '[Missing](cooking/no-such-note)'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.get('cooking/no-such-note')).toBe('broken')
  })

  test('detects collision links', async () => {
    // Create a second note with the same slug as "my-note"
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Another Note\n\nDuplicate slug.',
      inserter: 'test-user',
      slug: 'my-note'
    })
    await indexAll(localDb)

    const content = '[Dupe](my-note)'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.get('my-note')).toBe('conflict')
  })

  test('skips external links', async () => {
    const content = '[Google](https://google.com) and [Local](my-note)'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.has('https://google.com')).toBe(false)
    expect(statuses.get('my-note')).toBe('ok')
  })

  test('skips tag links', async () => {
    const content = '[#cooking](#cooking)'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.has('#cooking')).toBe(false)
  })

  test('validates wikilinks as ok when title exists', async () => {
    const content = '[[My Note]]'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.get('wikilink:My Note')).toBe('ok')
  })

  test('validates wikilinks as broken when title is missing', async () => {
    const content = '[[No Such Note]]'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.get('wikilink:No Such Note')).toBe('broken')
  })

  test('resolves relative links with current slug path', async () => {
    const content = '[Pasta](./pasta-recipe)'
    const statuses = await validateLinks(localDb, content, 'cooking/some-note')
    expect(statuses.get('./pasta-recipe')).toBe('ok')
  })

  test('marks relative links as broken without current slug path', async () => {
    const content = '[Pasta](./pasta-recipe)'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.get('./pasta-recipe')).toBe('broken')
  })

  test('handles multiple links in one document', async () => {
    const content = [
      '[Good](my-note)',
      '[Bad](nonexistent)',
      '[Pasta](cooking/pasta-recipe)',
    ].join('\n\n')

    const statuses = await validateLinks(localDb, content)
    expect(statuses.get('my-note')).toBe('ok')
    expect(statuses.get('nonexistent')).toBe('broken')
    expect(statuses.get('cooking/pasta-recipe')).toBe('ok')
  })

  test('deduplicates repeated links', async () => {
    const content = '[A](my-note) and [B](my-note)'
    const statuses = await validateLinks(localDb, content)
    expect(statuses.get('my-note')).toBe('ok')
    // Map has exactly one entry for this href
    const slugEntries = [...statuses.entries()].filter(([k]) => k === 'my-note')
    expect(slugEntries.length).toBe(1)
  })

  test('returns empty map when no library exists', async () => {
    // Create a fresh DB without library
    const fresh = await createTestClientWithStream('Empty')
    const freshLocal = fresh.stream.local()
    // Delete the library collection to simulate missing library
    await freshLocal.query(`DELETE FROM collection`, [])

    const statuses = await validateLinks(freshLocal, '[link](test)')
    expect(statuses.size).toBe(0)
  })
})
