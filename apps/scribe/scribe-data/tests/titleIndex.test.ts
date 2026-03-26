import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { up } from '../src/migrations.js'
import { rebuildTitleIndex, lookupByTitle } from '../src/titleIndex.js'
import { indexSlugs, indexAll } from '../src/indexing.js'
import { createNote } from '../src/note.js'
import { createCollection } from '../src/collection.js'
import { createTestDB } from './test-utils.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'

describe('title index', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal

  beforeEach(async () => {
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    await up(syncedDb, localDb)
  })

  afterEach(async () => {
    // Cleanup handled by test framework
  })

  test('title_index table is created by migration', async () => {
    const result = await localDb.query('SELECT * FROM title_index', [])
    expect(result.rows).toBeDefined()
    expect(result.rows).toHaveLength(0)
  })

  test('rebuildTitleIndex indexes notes with titles', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# My Recipe\n\nA delicious recipe.',
      inserter: 'test-user'
    })

    await indexSlugs(localDb)
    await rebuildTitleIndex(localDb)

    const results = await lookupByTitle(localDb, 'My Recipe')
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('My Recipe')
    expect(results[0].entity_type).toBe('note')
    expect(results[0].slug_path).toBe('my-recipe')
  })

  test('rebuildTitleIndex skips notes without titles', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: 'No heading here, just content.',
      inserter: 'test-user'
    })

    await indexSlugs(localDb)
    await rebuildTitleIndex(localDb)

    const result = await localDb.query('SELECT * FROM title_index', [])
    expect(result.rows).toHaveLength(0)
  })

  test('rebuildTitleIndex indexes collections by their title', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user'
    })

    await createCollection(syncedDb, {
      title: 'Recipes',
      parent_collection_uuid: root.collection_uuid,
      inserter: 'test-user'
    })

    await rebuildTitleIndex(localDb)

    const results = await lookupByTitle(localDb, 'Recipes')
    expect(results).toHaveLength(1)
    expect(results[0].entity_type).toBe('collection')
    expect(results[0].slug_path).toBe('recipes')
  })

  test('rebuildTitleIndex does not index root collection', async () => {
    await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user'
    })

    await rebuildTitleIndex(localDb)

    const results = await lookupByTitle(localDb, 'My Library')
    expect(results).toHaveLength(0)
  })

  test('lookupByTitle is case-insensitive', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# My Recipe\n\nContent.',
      inserter: 'test-user'
    })

    await indexSlugs(localDb)
    await rebuildTitleIndex(localDb)

    const lower = await lookupByTitle(localDb, 'my recipe')
    expect(lower).toHaveLength(1)
    expect(lower[0].title).toBe('My Recipe')

    const upper = await lookupByTitle(localDb, 'MY RECIPE')
    expect(upper).toHaveLength(1)

    const mixed = await lookupByTitle(localDb, 'mY rEcIpE')
    expect(mixed).toHaveLength(1)
  })

  test('notes in nested collections produce correct slug_path', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user'
    })

    const cooking = await createCollection(syncedDb, {
      title: 'Cooking',
      parent_collection_uuid: root.collection_uuid,
      inserter: 'test-user'
    })

    const italian = await createCollection(syncedDb, {
      title: 'Italian',
      parent_collection_uuid: cooking.collection_uuid,
      inserter: 'test-user'
    })

    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pasta\n\nA pasta recipe.',
      inserter: 'test-user',
      collection_id: italian.collection_uuid
    })

    await indexSlugs(localDb)
    await rebuildTitleIndex(localDb)

    const results = await lookupByTitle(localDb, 'Pasta')
    expect(results).toHaveLength(1)
    expect(results[0].slug_path).toBe('cooking/italian/pasta')
  })

  test('flat index: same title in different collections both appear', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user'
    })

    const recipes = await createCollection(syncedDb, {
      title: 'Recipes',
      parent_collection_uuid: root.collection_uuid,
      inserter: 'test-user'
    })

    const travel = await createCollection(syncedDb, {
      title: 'Travel',
      parent_collection_uuid: root.collection_uuid,
      inserter: 'test-user'
    })

    // Two notes with the same title in different collections
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Italian\n\nItalian recipes.',
      inserter: 'test-user',
      collection_id: recipes.collection_uuid
    })

    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Italian\n\nItalian travel notes.',
      inserter: 'test-user',
      collection_id: travel.collection_uuid
    })

    await indexSlugs(localDb)
    await rebuildTitleIndex(localDb)

    const results = await lookupByTitle(localDb, 'Italian')
    // Should include both notes + the "Italian" collection if it existed
    // Here we only have the two notes + no collection named "Italian"
    // But we DO have "Recipes" and "Travel" collections that happen to be
    // in the index too, just under different titles
    const noteResults = results.filter(r => r.entity_type === 'note')
    expect(noteResults).toHaveLength(2)

    const slugPaths = noteResults.map(r => r.slug_path).sort()
    expect(slugPaths).toEqual(['recipes/italian', 'travel/italian'])
  })

  test('multiple entities with same title all returned (collision detection)', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user'
    })

    // Two notes with same title in same collection
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pasta\n\nFirst pasta recipe.',
      inserter: 'test-user',
      collection_id: root.collection_uuid
    })

    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pasta\n\nSecond pasta recipe.',
      inserter: 'test-user',
      collection_id: root.collection_uuid
    })

    await indexSlugs(localDb)
    await rebuildTitleIndex(localDb)

    const results = await lookupByTitle(localDb, 'Pasta')
    expect(results).toHaveLength(2)
    expect(results.every(r => r.title === 'Pasta')).toBe(true)
  })

  test('indexAll includes title index rebuild', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user'
    })

    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Test Note\n\nContent.',
      inserter: 'test-user',
      collection_id: root.collection_uuid
    })

    // indexAll should rebuild the title index as part of its work
    await indexAll(localDb)

    const results = await lookupByTitle(localDb, 'Test Note')
    expect(results).toHaveLength(1)
    expect(results[0].slug_path).toBe('test-note')
  })

  test('rebuild replaces stale entries when titles change', async () => {
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Old Title\n\nContent.',
      inserter: 'test-user'
    })

    await indexSlugs(localDb)
    await rebuildTitleIndex(localDb)

    let results = await lookupByTitle(localDb, 'Old Title')
    expect(results).toHaveLength(1)

    // Update the note with a new title
    const { createNoteVersion } = await import('../src/note.js')
    await createNoteVersion(syncedDb, note.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# New Title\n\nUpdated content.',
      inserter: 'test-user'
    })

    await indexSlugs(localDb)
    await rebuildTitleIndex(localDb)

    // Old title should be gone
    results = await lookupByTitle(localDb, 'Old Title')
    expect(results).toHaveLength(0)

    // New title should be present
    results = await lookupByTitle(localDb, 'New Title')
    expect(results).toHaveLength(1)
  })

  test('lookupByTitle returns empty array for non-existent title', async () => {
    const results = await lookupByTitle(localDb, 'Does Not Exist')
    expect(results).toHaveLength(0)
  })

  test('collections nested multiple levels produce correct slug_path', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user'
    })

    const a = await createCollection(syncedDb, {
      title: 'A',
      parent_collection_uuid: root.collection_uuid,
      inserter: 'test-user'
    })

    const b = await createCollection(syncedDb, {
      title: 'B',
      parent_collection_uuid: a.collection_uuid,
      inserter: 'test-user'
    })

    const c = await createCollection(syncedDb, {
      title: 'C',
      parent_collection_uuid: b.collection_uuid,
      inserter: 'test-user'
    })

    await rebuildTitleIndex(localDb)

    const results = await lookupByTitle(localDb, 'C')
    expect(results).toHaveLength(1)
    expect(results[0].slug_path).toBe('a/b/c')
    expect(results[0].entity_type).toBe('collection')
  })
})
