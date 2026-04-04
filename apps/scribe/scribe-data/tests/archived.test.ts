import { test, expect, describe, beforeEach } from 'vitest'
import { up } from '../src/migrations.js'
import {
  indexAll,
  rebuildSlugCollisions,
  getCollidingSlugs,
  getAllNotesWithTitles,
  getNotesInCollectionWithSlugs,
  getNotesBySlug,
  getNotesBySlugInCollection,
  getNoteSlugByUuid,
} from '../src/indexing.js'
import { searchNotes } from '../src/search.js'
import { createTestDB } from './test-utils.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'
import { createNote, createNoteVersion } from '../src/note.js'
import {
  createCollection,
  getLibrary,
  getAllCollections,
  getAllCollectionsWithSlugs,
  getChildCollections,
  getCollectionsBySlug,
  getCollectionBySlug,
  getCollectionBySlugUnderParent,
  getNotesInCollection,
  getLinkedLibraries,
} from '../src/collection.js'
import { resolveSlugPath, suggestSlugs } from '../src/slug.js'
import { rebuildTitleIndex, lookupByTitle } from '../src/titleIndex.js'

describe('archived behavior', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let libraryUuid: string

  beforeEach(async () => {
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    await up(syncedDb, localDb)

    const lib = await createCollection(syncedDb, { title: 'Library', inserter: 'user' })
    libraryUuid = lib.collection_uuid
  })

  // -----------------------------------------------------------------------
  // Notes: listing
  // -----------------------------------------------------------------------

  test('archived notes are excluded from getAllNotesWithTitles by default', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Active Note',
      inserter: 'user',
      collection_id: libraryUuid,
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Archived Note',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })
    await indexAll(localDb)

    const active = await getAllNotesWithTitles(localDb)
    expect(active).toHaveLength(1)
    expect(active[0].title).toBe('Active Note')
    expect(active[0].archived).toBe(false)

    const archived = await getAllNotesWithTitles(localDb, { archived: true })
    expect(archived).toHaveLength(1)
    expect(archived[0].title).toBe('Archived Note')
    expect(archived[0].archived).toBe(true)
  })

  test('archived notes are excluded from getNotesInCollectionWithSlugs by default', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Active',
      inserter: 'user',
      collection_id: libraryUuid,
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Archived',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })
    await indexAll(localDb)

    const active = await getNotesInCollectionWithSlugs(localDb, libraryUuid)
    expect(active).toHaveLength(1)
    expect(active[0].title).toBe('Active')

    const archived = await getNotesInCollectionWithSlugs(localDb, libraryUuid, { archived: true })
    expect(archived).toHaveLength(1)
    expect(archived[0].title).toBe('Archived')
  })

  test('archived notes are excluded from getNotesInCollection by default', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Active',
      inserter: 'user',
      collection_id: libraryUuid,
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Archived',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })

    const active = await getNotesInCollection(syncedDb, libraryUuid)
    expect(active).toHaveLength(1)
    expect(active[0].body).toContain('Active')

    const archived = await getNotesInCollection(syncedDb, libraryUuid, { archived: true })
    expect(archived).toHaveLength(1)
    expect(archived[0].body).toContain('Archived')
  })

  // -----------------------------------------------------------------------
  // Notes: slug-based lookups exclude archived
  // -----------------------------------------------------------------------

  test('archived notes are not found by slug', async () => {
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# My Note',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })
    await indexAll(localDb)

    // Slug lookup should not find archived note
    const bySlug = await getNotesBySlug(localDb, 'my-note')
    expect(bySlug).toHaveLength(0)

    const inCollection = await getNotesBySlugInCollection(localDb, 'my-note', libraryUuid)
    expect(inCollection).toHaveLength(0)

    // UUID lookup should still find it
    const byUuid = await getNoteSlugByUuid(localDb, note.block_uuid)
    expect(byUuid).not.toBeNull()
    expect(byUuid!.slug).toBe('my-note')
  })

  // -----------------------------------------------------------------------
  // Notes: archived does not cause slug collisions
  // -----------------------------------------------------------------------

  test('archived notes do not cause slug collisions', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pasta',
      inserter: 'user',
      collection_id: libraryUuid,
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pasta',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })
    await indexAll(localDb)

    const collisions = await getCollidingSlugs(localDb, libraryUuid)
    expect(collisions.size).toBe(0)
  })

  // -----------------------------------------------------------------------
  // Notes: createNoteVersion carries forward archived
  // -----------------------------------------------------------------------

  test('createNoteVersion carries forward archived status', async () => {
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Original',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })

    const v2 = await createNoteVersion(syncedDb, note.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# Updated',
      inserter: 'user',
    })

    expect(v2.archived).toBe(true)
  })

  test('createNoteVersion can override archived status', async () => {
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Original',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })

    const v2 = await createNoteVersion(syncedDb, note.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# Unarchived',
      inserter: 'user',
      archived: false,
    })

    expect(v2.archived).toBe(false)
  })

  // -----------------------------------------------------------------------
  // Collections: listing
  // -----------------------------------------------------------------------

  test('archived collections are excluded from listing functions by default', async () => {
    await createCollection(syncedDb, {
      title: 'Active Collection',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
    })
    await createCollection(syncedDb, {
      title: 'Archived Collection',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
      archived: true,
    })

    const all = await getAllCollections(syncedDb)
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('Active Collection')

    const allArchived = await getAllCollections(syncedDb, { archived: true })
    expect(allArchived).toHaveLength(1)
    expect(allArchived[0].title).toBe('Archived Collection')
  })

  test('archived collections are excluded from getAllCollectionsWithSlugs by default', async () => {
    await createCollection(syncedDb, {
      title: 'Active',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
    })
    await createCollection(syncedDb, {
      title: 'Archived',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
      archived: true,
    })

    const active = await getAllCollectionsWithSlugs(localDb)
    expect(active).toHaveLength(1)
    expect(active[0].title).toBe('Active')

    const archived = await getAllCollectionsWithSlugs(localDb, { archived: true })
    expect(archived).toHaveLength(1)
    expect(archived[0].title).toBe('Archived')
  })

  test('archived collections are excluded from getChildCollections by default', async () => {
    await createCollection(syncedDb, {
      title: 'Active Child',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
    })
    await createCollection(syncedDb, {
      title: 'Archived Child',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
      archived: true,
    })

    const children = await getChildCollections(syncedDb, libraryUuid)
    expect(children).toHaveLength(1)
    expect(children[0].title).toBe('Active Child')

    const archivedChildren = await getChildCollections(syncedDb, libraryUuid, { archived: true })
    expect(archivedChildren).toHaveLength(1)
    expect(archivedChildren[0].title).toBe('Archived Child')
  })

  // -----------------------------------------------------------------------
  // Collections: slug-based lookups exclude archived
  // -----------------------------------------------------------------------

  test('archived collections are not found by slug', async () => {
    await createCollection(syncedDb, {
      title: 'Recipes',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
      archived: true,
    })

    const bySlug = await getCollectionsBySlug(localDb, 'recipes')
    expect(bySlug).toHaveLength(0)

    const bySlugSingle = await getCollectionBySlug(localDb, 'recipes')
    expect(bySlugSingle).toBeNull()

    const underParent = await getCollectionBySlugUnderParent(localDb, 'recipes', libraryUuid)
    expect(underParent).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Slug resolution excludes archived
  // -----------------------------------------------------------------------

  test('resolveSlugPath does not resolve archived collections', async () => {
    await createCollection(syncedDb, {
      title: 'Recipes',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
      archived: true,
    })

    const result = await resolveSlugPath(localDb, ['recipes'], libraryUuid)
    expect(result).toBeNull()
  })

  test('resolveSlugPath does not resolve archived notes', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pasta',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })
    await indexAll(localDb)

    const result = await resolveSlugPath(localDb, ['pasta'], libraryUuid)
    expect(result).toBeNull()
  })

  // -----------------------------------------------------------------------
  // Suggest slugs excludes archived
  // -----------------------------------------------------------------------

  test('suggestSlugs does not include archived items', async () => {
    await createCollection(syncedDb, {
      title: 'Recipes',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
    })
    await createCollection(syncedDb, {
      title: 'Reports',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
      archived: true,
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Rice',
      inserter: 'user',
      collection_id: libraryUuid,
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Reviews',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })
    await indexAll(localDb)

    const suggestions = await suggestSlugs(localDb, ['r'], libraryUuid, { limit: 10 })
    const titles = suggestions.map(s => s.title)
    expect(titles).toContain('Recipes')
    expect(titles).toContain('Rice')
    expect(titles).not.toContain('Reports')
    expect(titles).not.toContain('Reviews')
  })

  // -----------------------------------------------------------------------
  // Search: archived items show up last but still appear
  // -----------------------------------------------------------------------

  test('search includes archived notes but ranks them last', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Pancake Recipe\n\nA delicious pancake recipe with butter.',
      inserter: 'user',
      collection_id: libraryUuid,
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Old Pancake Recipe\n\nAn archived pancake recipe with syrup.',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })
    await indexAll(localDb)

    const results = await searchNotes(localDb, 'pancake')
    expect(results).toHaveLength(2)

    // Active note should come first
    expect(results[0].archived).toBe(false)
    expect(results[1].archived).toBe(true)
  })

  // -----------------------------------------------------------------------
  // Title index excludes archived
  // -----------------------------------------------------------------------

  test('archived items are excluded from title index', async () => {
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Active Title',
      inserter: 'user',
      collection_id: libraryUuid,
    })
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Archived Title',
      inserter: 'user',
      collection_id: libraryUuid,
      archived: true,
    })
    await createCollection(syncedDb, {
      title: 'Active Collection',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
    })
    await createCollection(syncedDb, {
      title: 'Archived Collection',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
      archived: true,
    })
    await indexAll(localDb)

    const activeNote = await lookupByTitle(localDb, 'Active Title')
    expect(activeNote).toHaveLength(1)

    const archivedNote = await lookupByTitle(localDb, 'Archived Title')
    expect(archivedNote).toHaveLength(0)

    const activeCollection = await lookupByTitle(localDb, 'Active Collection')
    expect(activeCollection).toHaveLength(1)

    const archivedCollection = await lookupByTitle(localDb, 'Archived Collection')
    expect(archivedCollection).toHaveLength(0)
  })

  // -----------------------------------------------------------------------
  // Linked libraries: archived excluded by default
  // -----------------------------------------------------------------------

  test('archived linked libraries are excluded by default', async () => {
    await createCollection(syncedDb, {
      title: 'Active Lib',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
      linked_stream_id: 'stream-1',
      linked_stream_key: 'key-1',
    })
    await createCollection(syncedDb, {
      title: 'Archived Lib',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
      linked_stream_id: 'stream-2',
      linked_stream_key: 'key-2',
      archived: true,
    })

    const active = await getLinkedLibraries(syncedDb)
    expect(active).toHaveLength(1)
    expect(active[0].title).toBe('Active Lib')

    const archived = await getLinkedLibraries(syncedDb, { archived: true })
    expect(archived).toHaveLength(1)
    expect(archived[0].title).toBe('Archived Lib')
  })

  // -----------------------------------------------------------------------
  // Migration: existing items default to archived=false
  // -----------------------------------------------------------------------

  test('new notes default to archived=false', async () => {
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Default Note',
      inserter: 'user',
      collection_id: libraryUuid,
    })

    expect(note.archived).toBe(false)
  })

  test('new collections default to archived=false', async () => {
    const collection = await createCollection(syncedDb, {
      title: 'Default Collection',
      parent_collection_uuid: libraryUuid,
      inserter: 'user',
    })

    expect(collection.archived).toBe(false)
  })
})
