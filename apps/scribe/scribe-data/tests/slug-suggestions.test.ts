import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { up } from '../src/migrations.js'
import { createTestDB } from './test-utils.js'
import { createCollection } from '../src/collection.js'
import { createNote } from '../src/note.js'
import { indexAll } from '../src/indexing.js'
import { suggestSlugs } from '../src/slug.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'

describe('suggestSlugs', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let libraryUuid: string

  beforeEach(async () => {
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    await up(syncedDb, localDb)

    const library = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user'
    })
    libraryUuid = library.collection_uuid
  })

  test('returns empty array when no slugs match', async () => {
    const suggestions = await suggestSlugs(localDb, ['xyz'], libraryUuid)
    expect(suggestions).toEqual([])
  })

  test('matches notes at the library root by prefix', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Grocery List\n\nMilk, eggs.',
      inserter: 'test-user'
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Great Ideas\n\nSome ideas.',
      inserter: 'test-user'
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Unrelated\n\nNot matching.',
      inserter: 'test-user'
    })
    await indexAll(localDb)

    const suggestions = await suggestSlugs(localDb, ['gr'], libraryUuid)

    expect(suggestions.length).toBe(2)
    expect(suggestions.every(s => s.type === 'note')).toBe(true)
    expect(suggestions.every(s => s.slug_path.startsWith('gr'))).toBe(true)
  })

  test('matches collections at the library root by prefix', async () => {
    await createCollection(syncedDb, {
      title: 'Cooking',
      parent_collection_uuid: libraryUuid,
      inserter: 'test-user'
    })
    await createCollection(syncedDb, {
      title: 'Crafts',
      parent_collection_uuid: libraryUuid,
      inserter: 'test-user'
    })

    const suggestions = await suggestSlugs(localDb, ['co'], libraryUuid)

    expect(suggestions.length).toBe(1)
    expect(suggestions[0].type).toBe('collection')
    expect(suggestions[0].slug_path).toBe('cooking')
    expect(suggestions[0].title).toBe('Cooking')
  })

  test('matches both notes and collections', async () => {
    await createCollection(syncedDb, {
      title: 'Cooking',
      parent_collection_uuid: libraryUuid,
      inserter: 'test-user'
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Cool Stuff\n\nContent.',
      inserter: 'test-user'
    })
    await indexAll(localDb)

    const suggestions = await suggestSlugs(localDb, ['coo'], libraryUuid)

    expect(suggestions.length).toBe(2)
    const types = suggestions.map(s => s.type).sort()
    expect(types).toEqual(['collection', 'note'])
  })

  test('scopes search to parent collection from prefix path', async () => {
    const cooking = await createCollection(syncedDb, {
      title: 'Cooking',
      parent_collection_uuid: libraryUuid,
      inserter: 'test-user'
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pasta\n\nBoil water.',
      inserter: 'test-user',
      collection_id: cooking.collection_uuid
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pancakes\n\nMix batter.',
      inserter: 'test-user',
      collection_id: cooking.collection_uuid
    })
    // A note at root that should NOT match
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Painting\n\nArt stuff.',
      inserter: 'test-user'
    })
    await indexAll(localDb)

    const suggestions = await suggestSlugs(localDb, ['cooking', 'pa'], libraryUuid)

    expect(suggestions.length).toBe(2)
    expect(suggestions.every(s => s.slug_path.startsWith('cooking/pa'))).toBe(true)
  })

  test('returns empty when parent path does not exist', async () => {
    const suggestions = await suggestSlugs(localDb, ['nonexistent', 'foo'], libraryUuid)
    expect(suggestions).toEqual([])
  })

  test('respects limit option', async () => {
    for (let i = 0; i < 10; i++) {
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: `# Note ${i}\n\nContent.`,
        inserter: 'test-user'
      })
    }
    await indexAll(localDb)

    const suggestions = await suggestSlugs(localDb, ['note'], libraryUuid, { limit: 3 })
    expect(suggestions.length).toBe(3)
  })

  test('defaults limit to 5', async () => {
    for (let i = 0; i < 10; i++) {
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: `# Test ${i}\n\nContent.`,
        inserter: 'test-user'
      })
    }
    await indexAll(localDb)

    const suggestions = await suggestSlugs(localDb, ['test'], libraryUuid)
    expect(suggestions.length).toBe(5)
  })

  test('filters by slug_type note', async () => {
    await createCollection(syncedDb, {
      title: 'Cooking',
      parent_collection_uuid: libraryUuid,
      inserter: 'test-user'
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Cool Beans\n\nContent.',
      inserter: 'test-user'
    })
    await indexAll(localDb)

    const suggestions = await suggestSlugs(localDb, ['coo'], libraryUuid, { slug_type: 'note' })

    expect(suggestions.length).toBe(1)
    expect(suggestions[0].type).toBe('note')
  })

  test('filters by slug_type collection', async () => {
    await createCollection(syncedDb, {
      title: 'Cooking',
      parent_collection_uuid: libraryUuid,
      inserter: 'test-user'
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Cool Beans\n\nContent.',
      inserter: 'test-user'
    })
    await indexAll(localDb)

    const suggestions = await suggestSlugs(localDb, ['coo'], libraryUuid, { slug_type: 'collection' })

    expect(suggestions.length).toBe(1)
    expect(suggestions[0].type).toBe('collection')
  })

  test('works with nested collection paths', async () => {
    const cooking = await createCollection(syncedDb, {
      title: 'Cooking',
      parent_collection_uuid: libraryUuid,
      inserter: 'test-user'
    })
    const italian = await createCollection(syncedDb, {
      title: 'Italian',
      parent_collection_uuid: cooking.collection_uuid,
      inserter: 'test-user'
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pasta\n\nBoil water.',
      inserter: 'test-user',
      collection_id: italian.collection_uuid
    })
    await indexAll(localDb)

    const suggestions = await suggestSlugs(localDb, ['cooking', 'italian', 'pa'], libraryUuid)

    expect(suggestions.length).toBe(1)
    expect(suggestions[0].slug_path).toBe('cooking/italian/pasta')
    expect(suggestions[0].type).toBe('note')
  })

  test('empty segments returns items at library root', async () => {
    await createCollection(syncedDb, {
      title: 'Cooking',
      parent_collection_uuid: libraryUuid,
      inserter: 'test-user'
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Hello\n\nWorld.',
      inserter: 'test-user'
    })
    await indexAll(localDb)

    const suggestions = await suggestSlugs(localDb, [], libraryUuid)

    // Empty segments: searchPrefix is '', LIKE '%' matches everything at root
    expect(suggestions.length).toBe(2)
  })

  test('sub-collections appear in suggestions under parent', async () => {
    const cooking = await createCollection(syncedDb, {
      title: 'Cooking',
      parent_collection_uuid: libraryUuid,
      inserter: 'test-user'
    })
    await createCollection(syncedDb, {
      title: 'Italian',
      parent_collection_uuid: cooking.collection_uuid,
      inserter: 'test-user'
    })
    await createCollection(syncedDb, {
      title: 'Indian',
      parent_collection_uuid: cooking.collection_uuid,
      inserter: 'test-user'
    })

    const suggestions = await suggestSlugs(localDb, ['cooking', 'i'], libraryUuid)

    expect(suggestions.length).toBe(2)
    expect(suggestions.every(s => s.type === 'collection')).toBe(true)
    expect(suggestions.map(s => s.slug_path).sort()).toEqual([
      'cooking/indian',
      'cooking/italian'
    ])
  })
})
