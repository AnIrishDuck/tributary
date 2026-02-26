import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { up, down } from '../src/migrations.js'
import { createTestDB } from './test-utils.js'
import {
  createCollection,
  moveCollection,
  getCollectionByUuid,
  getAllCollections,
  getLinkedLibraries,
  getLibrary,
  getNotesInCollection,
  getLibraryDisplayName,
  getChildCollections,
  getCollectionAncestors,
  getCollectionsBySlug,
  getCollectionBySlugUnderParent,
  getSlugPath,
  getNoteSlugPath
} from '../src/collection.js'
import { createNote, createNoteVersion, moveNote, getLatestNoteVersion } from '../src/note.js'
import { indexCollectionSlugs, getNotesInCollectionWithSlugs, indexAll, getNotesBySlugInCollection } from '../src/indexing.js'
import { resolveSlugPath, resolveSlugPathPartial } from '../src/slug.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'

describe('Collection Operations', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    cleanup = async () => {}

    await up(syncedDb, localDb)
  })

  afterEach(async () => {
    if (cleanup) {
      await cleanup()
    }
  })

  describe('Library', () => {
    test('getLibrary returns null when no library exists', async () => {
      const root = await getLibrary(syncedDb)
      expect(root).toBeNull()
    })

    test('should create a library (parent_collection_uuid = null)', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      expect(root).toBeDefined()
      expect(root.collection_uuid).toBeDefined()
      expect(root.title).toBe('My Stream')
      expect(root.parent_collection_uuid).toBeNull()
      expect(root.inserter).toBe('test-user')
    })

    test('getLibrary returns the library after creation', async () => {
      const created = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const root = await getLibrary(syncedDb)

      expect(root).toBeDefined()
      expect(root?.collection_uuid).toBe(created.collection_uuid)
      expect(root?.title).toBe('My Stream')
    })

    test('getLibrary works via TributaryLocal (for listing)', async () => {
      const created = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      // localDb shares the same schema, so getLibrary should work
      const root = await getLibrary(localDb)

      expect(root).toBeDefined()
      expect(root?.collection_uuid).toBe(created.collection_uuid)
      expect(root?.title).toBe('My Stream')
    })

    test('getLibrary via TributaryLocal returns null when no library exists', async () => {
      const root = await getLibrary(localDb)
      expect(root).toBeNull()
    })

    test('should enforce at most one library (constraint)', async () => {
      await createCollection(syncedDb, {
        title: 'First Root',
        inserter: 'test-user'
      })

      // Attempting to create a second library should fail
      await expect(
        createCollection(syncedDb, {
          title: 'Second Root',
          inserter: 'test-user'
        })
      ).rejects.toThrow()
    })

    test('should allow creating a library with a specified UUID', async () => {
      const uuid = uuidv4()
      const root = await createCollection(syncedDb, {
        collection_uuid: uuid,
        title: 'My Stream',
        inserter: 'test-user'
      })

      expect(root.collection_uuid).toBe(uuid)
    })
  })

  describe('Named Collections', () => {
    test('should create a named collection under the library', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      expect(cajun).toBeDefined()
      expect(cajun.title).toBe('Cajun Recipes')
      expect(cajun.parent_collection_uuid).toBe(root.collection_uuid)
    })

    test('should create multiple named collections under the library', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const desserts = await createCollection(syncedDb, {
        title: 'Desserts',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      expect(cajun.collection_uuid).not.toBe(desserts.collection_uuid)
      expect(cajun.parent_collection_uuid).toBe(root.collection_uuid)
      expect(desserts.parent_collection_uuid).toBe(root.collection_uuid)
    })
  })

  describe('getCollectionByUuid', () => {
    test('should retrieve a collection by UUID', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const retrieved = await getCollectionByUuid(syncedDb, root.collection_uuid)

      expect(retrieved).toBeDefined()
      expect(retrieved?.collection_uuid).toBe(root.collection_uuid)
      expect(retrieved?.title).toBe('My Stream')
    })

    test('should return null for a non-existent UUID', async () => {
      const result = await getCollectionByUuid(syncedDb, uuidv4())
      expect(result).toBeNull()
    })
  })

  describe('getAllCollections', () => {
    test('should return empty array when no collections exist', async () => {
      const collections = await getAllCollections(syncedDb)
      expect(collections).toEqual([])
    })

    test('should return empty array when only library exists', async () => {
      await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const collections = await getAllCollections(syncedDb)
      expect(collections).toEqual([])
    })

    test('should return named collections (not the library)', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Desserts',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const collections = await getAllCollections(syncedDb)

      expect(collections).toHaveLength(2)
      expect(collections.map(c => c.title)).toContain('Cajun Recipes')
      expect(collections.map(c => c.title)).toContain('Desserts')
      // Library should not be included
      expect(collections.map(c => c.title)).not.toContain('My Stream')
    })

    test('should sort named collections by title', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Desserts',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Appetizers',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const collections = await getAllCollections(syncedDb)

      expect(collections[0].title).toBe('Appetizers')
      expect(collections[1].title).toBe('Cajun Recipes')
      expect(collections[2].title).toBe('Desserts')
    })
  })

  describe('Note-Collection Relationship', () => {
    test('notes without collection_id belong to library (null)', async () => {
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Root Note\n\nThis note belongs to the library.',
        inserter: 'test-user'
      })

      expect(note.collection_id).toBeNull()
    })

    test('should create a note assigned to a named collection', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Gumbo\n\nA classic cajun dish.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      expect(note.collection_id).toBe(cajun.collection_uuid)
    })

    test('should carry forward collection_id when creating a new version', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Gumbo\n\nOriginal recipe.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      const updatedNote = await createNoteVersion(syncedDb, note.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Gumbo\n\nUpdated recipe with more spice.',
        inserter: 'test-user'
      })

      expect(updatedNote.collection_id).toBe(cajun.collection_uuid)
    })

    test('should allow moving a note to a different collection via new version', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const desserts = await createCollection(syncedDb, {
        title: 'Desserts',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Bread Pudding\n\nIs it cajun or dessert?',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      expect(note.collection_id).toBe(cajun.collection_uuid)

      const moved = await createNoteVersion(syncedDb, note.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Bread Pudding\n\nIs it cajun or dessert?',
        inserter: 'test-user',
        collection_id: desserts.collection_uuid
      })

      expect(moved.collection_id).toBe(desserts.collection_uuid)
    })

    test('should allow removing a note from a collection (move to library)', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Misplaced Note\n\nThis does not belong here.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      const moved = await createNoteVersion(syncedDb, note.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Misplaced Note\n\nThis does not belong here.',
        inserter: 'test-user',
        collection_id: null
      })

      expect(moved.collection_id).toBeNull()
    })
  })

  describe('getNotesInCollection', () => {
    test('should return library-level notes (collection_id IS NULL)', async () => {
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Root Note A\n\nFirst root note.',
        inserter: 'test-user'
      })

      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Root Note B\n\nSecond root note.',
        inserter: 'test-user'
      })

      const notes = await getNotesInCollection(syncedDb, null)

      expect(notes).toHaveLength(2)
    })

    test('should return notes in a named collection', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Gumbo\n\nA classic cajun stew.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Jambalaya\n\nRice-based cajun dish.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      // Also create a root note that should NOT appear
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Random Note\n\nNot in cajun.',
        inserter: 'test-user'
      })

      const cajunNotes = await getNotesInCollection(syncedDb, cajun.collection_uuid)

      expect(cajunNotes).toHaveLength(2)
      expect(cajunNotes.every(b => b.collection_id === cajun.collection_uuid)).toBe(true)
    })

    test('should return empty array for an empty collection', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const empty = await createCollection(syncedDb, {
        title: 'Empty Collection',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const notes = await getNotesInCollection(syncedDb, empty.collection_uuid)
      expect(notes).toEqual([])
    })

    test('should return only the latest version of each note', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Gumbo v1\n\nOriginal.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      await createNoteVersion(syncedDb, note.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Gumbo v2\n\nUpdated.',
        inserter: 'test-user'
      })

      const notes = await getNotesInCollection(syncedDb, cajun.collection_uuid)

      expect(notes).toHaveLength(1)
      expect(notes[0].body).toContain('Gumbo v2')
    })
  })

  describe('Library Structure (per docs)', () => {
    test('should model the example structure from the docs', async () => {
      // Library (root collection)
      // ├── note-a               (library-level note, collection_id = null)
      // ├── note-b               (library-level note, collection_id = null)
      // ├── cajun-recipes/         (named collection)
      // │   ├── gumbo             (note in collection)
      // │   └── jambalaya         (note in collection)
      // └── desserts/              (named collection)
      //     └── chocolate-cake    (note in collection)

      const root = await createCollection(syncedDb, {
        title: 'My Cookbook Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const desserts = await createCollection(syncedDb, {
        title: 'Desserts',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Note A\n\nLibrary-level note.',
        inserter: 'test-user'
      })

      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Note B\n\nAnother library-level note.',
        inserter: 'test-user'
      })

      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Gumbo\n\nA classic cajun stew.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Jambalaya\n\nRice-based cajun dish.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Chocolate Cake\n\nA rich chocolate dessert.',
        inserter: 'test-user',
        collection_id: desserts.collection_uuid
      })

      // Verify library
      const rootCol = await getLibrary(syncedDb)
      expect(rootCol?.title).toBe('My Cookbook Stream')

      // Verify named collections
      const collections = await getAllCollections(syncedDb)
      expect(collections).toHaveLength(2)

      // Verify notes per collection using getNotesInCollection
      const rootNotes = await getNotesInCollection(syncedDb, null)
      expect(rootNotes).toHaveLength(2)

      const cajunNotes = await getNotesInCollection(syncedDb, cajun.collection_uuid)
      expect(cajunNotes).toHaveLength(2)

      const dessertNotes = await getNotesInCollection(syncedDb, desserts.collection_uuid)
      expect(dessertNotes).toHaveLength(1)
    })
  })

  describe('Default Collection Behavior', () => {
    test('library with no root collection implies "Notes"', async () => {
      // Before creating a library, getLibrary returns null
      const root = await getLibrary(syncedDb)
      expect(root).toBeNull()

      // Notes can still be created — they belong to the implied library
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# My Note\n\nJust a regular note.',
        inserter: 'test-user'
      })

      expect(note.collection_id).toBeNull()

      // No collections in the table
      const collections = await getAllCollections(syncedDb)
      expect(collections).toHaveLength(0)

      // Library notes can still be queried
      const rootNotes = await getNotesInCollection(syncedDb, null)
      expect(rootNotes).toHaveLength(1)
    })
  })

  describe('getLibraryDisplayName', () => {
    test('returns null when no library exists (via TributaryStream)', async () => {
      const name = await getLibraryDisplayName(syncedDb)
      expect(name).toBeNull()
    })

    test('returns null when no library exists (via TributaryLocal)', async () => {
      const name = await getLibraryDisplayName(localDb)
      expect(name).toBeNull()
    })

    test('returns library title when one exists (via TributaryStream)', async () => {
      await createCollection(syncedDb, {
        title: 'My Cookbook',
        inserter: 'test-user'
      })

      const name = await getLibraryDisplayName(syncedDb)
      expect(name).toBe('My Cookbook')
    })

    test('returns library title when one exists (via TributaryLocal)', async () => {
      await createCollection(syncedDb, {
        title: 'My Cookbook',
        inserter: 'test-user'
      })

      const name = await getLibraryDisplayName(localDb)
      expect(name).toBe('My Cookbook')
    })
  })

  describe('Linked Libraries', () => {
    test('should create a linked library with linked_stream_id and linked_stream_key', async () => {
      const root = await createCollection(syncedDb, {
        title: 'Home',
        inserter: 'test-user'
      })

      const linked = await createCollection(syncedDb, {
        title: 'My Cookbook',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user',
        linked_stream_id: 'abc123streamid',
        linked_stream_key: 'xyz789writekey'
      })

      expect(linked.linked_stream_id).toBe('abc123streamid')
      expect(linked.linked_stream_key).toBe('xyz789writekey')
    })

    test('getLinkedLibraries returns only linked libraries', async () => {
      const root = await createCollection(syncedDb, {
        title: 'Home',
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Linked Cookbook',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user',
        linked_stream_id: 'stream-id-1',
        linked_stream_key: 'write-key-1'
      })

      await createCollection(syncedDb, {
        title: 'Linked Journal',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user',
        linked_stream_id: 'stream-id-2',
        linked_stream_key: 'write-key-2'
      })

      const linked = await getLinkedLibraries(syncedDb)
      expect(linked).toHaveLength(2)
      expect(linked[0].title).toBe('Linked Cookbook')
      expect(linked[0].linked_stream_id).toBe('stream-id-1')
      expect(linked[0].linked_stream_key).toBe('write-key-1')
      expect(linked[1].title).toBe('Linked Journal')
      expect(linked[1].linked_stream_id).toBe('stream-id-2')
      expect(linked[1].linked_stream_key).toBe('write-key-2')
    })

    test('getLinkedLibraries excludes normal (non-linked) collections', async () => {
      const root = await createCollection(syncedDb, {
        title: 'Home',
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Normal Collection',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Linked Collection',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user',
        linked_stream_id: 'stream-id-1',
        linked_stream_key: 'write-key-1'
      })

      const linked = await getLinkedLibraries(syncedDb)
      expect(linked).toHaveLength(1)
      expect(linked[0].title).toBe('Linked Collection')
    })

    test('getAllCollections still returns all named collections (linked or not)', async () => {
      const root = await createCollection(syncedDb, {
        title: 'Home',
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Normal Collection',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Linked Collection',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user',
        linked_stream_id: 'stream-id-1',
        linked_stream_key: 'write-key-1'
      })

      const all = await getAllCollections(syncedDb)
      expect(all).toHaveLength(2)
      expect(all.map(c => c.title)).toContain('Normal Collection')
      expect(all.map(c => c.title)).toContain('Linked Collection')
    })

    test('collections without linked fields default to null', async () => {
      const root = await createCollection(syncedDb, {
        title: 'Home',
        inserter: 'test-user'
      })

      const normal = await createCollection(syncedDb, {
        title: 'Regular',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      expect(normal.linked_stream_id).toBeNull()
      expect(normal.linked_stream_key).toBeNull()
    })
  })

  describe('Nesting', () => {
    test('createCollection defaults to root level (parent = null)', async () => {
      const collection = await createCollection(syncedDb, {
        title: 'Defaults To Root',
        inserter: 'test-user'
      })

      expect(collection.parent_collection_uuid).toBeNull()
    })

    test('named collections are direct children of the library (one level deep)', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const named = await createCollection(syncedDb, {
        title: 'Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      expect(named.parent_collection_uuid).toBe(root.collection_uuid)

      // getAllCollections returns only named collections
      const all = await getAllCollections(syncedDb)
      expect(all).toHaveLength(1)
      expect(all[0].title).toBe('Recipes')
    })

    test('create nested collections (library → child → grandchild)', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const child = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const grandchild = await createCollection(syncedDb, {
        title: 'Italian',
        parent_collection_uuid: child.collection_uuid,
        inserter: 'test-user'
      })

      expect(grandchild.parent_collection_uuid).toBe(child.collection_uuid)
      expect(child.parent_collection_uuid).toBe(library.collection_uuid)
      expect(library.parent_collection_uuid).toBeNull()
    })

    test('getChildCollections returns correct children at each level', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const child1 = await createCollection(syncedDb, {
        title: 'Alpha',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const child2 = await createCollection(syncedDb, {
        title: 'Beta',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const grandchild = await createCollection(syncedDb, {
        title: 'Gamma',
        parent_collection_uuid: child1.collection_uuid,
        inserter: 'test-user'
      })

      // Library's children: Alpha, Beta (sorted by title)
      const libraryChildren = await getChildCollections(syncedDb, library.collection_uuid)
      expect(libraryChildren).toHaveLength(2)
      expect(libraryChildren[0].title).toBe('Alpha')
      expect(libraryChildren[1].title).toBe('Beta')

      // Alpha's children: Gamma
      const alphaChildren = await getChildCollections(syncedDb, child1.collection_uuid)
      expect(alphaChildren).toHaveLength(1)
      expect(alphaChildren[0].title).toBe('Gamma')

      // Beta's children: none
      const betaChildren = await getChildCollections(syncedDb, child2.collection_uuid)
      expect(betaChildren).toHaveLength(0)

      // Gamma's children: none
      const gammaChildren = await getChildCollections(syncedDb, grandchild.collection_uuid)
      expect(gammaChildren).toHaveLength(0)
    })

    test('getCollectionAncestors returns correct chain from root to leaf', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const child = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const grandchild = await createCollection(syncedDb, {
        title: 'Italian',
        parent_collection_uuid: child.collection_uuid,
        inserter: 'test-user'
      })

      // Ancestors of grandchild: library → child → grandchild
      const ancestors = await getCollectionAncestors(syncedDb, grandchild.collection_uuid)
      expect(ancestors).toHaveLength(3)
      expect(ancestors[0].collection_uuid).toBe(library.collection_uuid)
      expect(ancestors[1].collection_uuid).toBe(child.collection_uuid)
      expect(ancestors[2].collection_uuid).toBe(grandchild.collection_uuid)

      // Ancestors of child: library → child
      const childAncestors = await getCollectionAncestors(syncedDb, child.collection_uuid)
      expect(childAncestors).toHaveLength(2)
      expect(childAncestors[0].collection_uuid).toBe(library.collection_uuid)
      expect(childAncestors[1].collection_uuid).toBe(child.collection_uuid)

      // Ancestors of library: just itself
      const libraryAncestors = await getCollectionAncestors(syncedDb, library.collection_uuid)
      expect(libraryAncestors).toHaveLength(1)
      expect(libraryAncestors[0].collection_uuid).toBe(library.collection_uuid)
    })

    test('notes in a subcollection do not appear in parent getNotesInCollectionWithSlugs', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const child = await createCollection(syncedDb, {
        title: 'Recipes',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      // Create a root-level note (no collection)
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Root Note\n\nA root-level note.',
        inserter: 'test-user'
      })

      // Create a note in the child collection
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Child Note\n\nA note in Recipes.',
        inserter: 'test-user',
        collection_id: child.collection_uuid
      })

      // Index so slugs exist
      await indexAll(localDb)

      // Root-level notes (collection_id IS NULL)
      const rootNotes = await getNotesInCollectionWithSlugs(localDb, null)
      expect(rootNotes).toHaveLength(1)
      expect(rootNotes[0].title).toBe('Root Note')

      // Notes in child collection
      const childNotes = await getNotesInCollectionWithSlugs(localDb, child.collection_uuid)
      expect(childNotes).toHaveLength(1)
      expect(childNotes[0].title).toBe('Child Note')

      // Notes in library collection itself (should be empty - notes are either root or in subcollection)
      const libraryNotes = await getNotesInCollectionWithSlugs(localDb, library.collection_uuid)
      expect(libraryNotes).toHaveLength(0)
    })
  })

  describe('Scoped slug resolution', () => {
    test('getCollectionBySlugUnderParent scopes to parent', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      // Create "Ideas" under library root
      const ideasRoot = await createCollection(syncedDb, {
        title: 'Ideas',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      // Create a child collection under ideasRoot
      const child = await createCollection(syncedDb, {
        title: 'Projects',
        parent_collection_uuid: ideasRoot.collection_uuid,
        inserter: 'test-user'
      })

      // Create another "Ideas" under the child collection
      const ideasNested = await createCollection(syncedDb, {
        title: 'Ideas',
        parent_collection_uuid: child.collection_uuid,
        inserter: 'test-user'
      })

      // Index collection slugs
      await indexCollectionSlugs(localDb)

      // Looking up "ideas" under library should return ideasRoot
      const resultUnderLibrary = await getCollectionBySlugUnderParent(localDb, 'ideas', library.collection_uuid)
      expect(resultUnderLibrary).not.toBeNull()
      expect(resultUnderLibrary!.collection_uuid).toBe(ideasRoot.collection_uuid)

      // Looking up "ideas" under child should return ideasNested
      const resultUnderChild = await getCollectionBySlugUnderParent(localDb, 'ideas', child.collection_uuid)
      expect(resultUnderChild).not.toBeNull()
      expect(resultUnderChild!.collection_uuid).toBe(ideasNested.collection_uuid)
    })

    test('getNotesBySlugInCollection scopes to collection', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const testCollection = await createCollection(syncedDb, {
        title: 'Test',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      // Create a note "Child" at root (collection_id=null)
      const rootChild = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Child\n\nRoot-level child.',
        inserter: 'test-user'
      })

      // Create a note "Child" inside collection "test"
      const nestedChild = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Child\n\nNested child in test.',
        inserter: 'test-user',
        collection_id: testCollection.collection_uuid
      })

      // Index slugs
      await indexAll(localDb)

      // Looking up slug "child" in collection "test" should return only the nested one
      const inCollection = await getNotesBySlugInCollection(localDb, 'child', testCollection.collection_uuid)
      expect(inCollection).toHaveLength(1)
      expect(inCollection[0].block_uuid).toBe(nestedChild.block_uuid)

      // Looking up slug "child" at root (null) should return only the root one
      const atRoot = await getNotesBySlugInCollection(localDb, 'child', null)
      expect(atRoot).toHaveLength(1)
      expect(atRoot[0].block_uuid).toBe(rootChild.block_uuid)
    })

    test('resolveSlugPath walks segments', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const cooking = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const italian = await createCollection(syncedDb, {
        title: 'Italian',
        parent_collection_uuid: cooking.collection_uuid,
        inserter: 'test-user'
      })

      const pasta = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Pasta\n\nDelicious pasta recipe.',
        inserter: 'test-user',
        collection_id: italian.collection_uuid
      })

      // Index everything
      await indexAll(localDb)

      // Resolve ['cooking', 'italian', 'pasta'] → note
      const pastaResult = await resolveSlugPath(localDb, ['cooking', 'italian', 'pasta'], library.collection_uuid)
      expect(pastaResult).not.toBeNull()
      expect(pastaResult!.type).toBe('note')
      expect(pastaResult!.entity.block_uuid).toBe(pasta.block_uuid)

      // Resolve ['cooking', 'italian'] → subcollection
      const italianResult = await resolveSlugPath(localDb, ['cooking', 'italian'], library.collection_uuid)
      expect(italianResult).not.toBeNull()
      expect(italianResult!.type).toBe('collection')
      expect(italianResult!.entity.collection_uuid).toBe(italian.collection_uuid)

      // Resolve ['cooking'] → collection
      const cookingResult = await resolveSlugPath(localDb, ['cooking'], library.collection_uuid)
      expect(cookingResult).not.toBeNull()
      expect(cookingResult!.type).toBe('collection')
      expect(cookingResult!.entity.collection_uuid).toBe(cooking.collection_uuid)
    })

    test('resolveSlugPath returns null for nonexistent path', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      await indexAll(localDb)

      const result = await resolveSlugPath(localDb, ['nonexistent'], library.collection_uuid)
      expect(result).toBeNull()
    })

    test('resolveSlugPath handles slug collision across scopes', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const testCollection = await createCollection(syncedDb, {
        title: 'Test',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      // A note "child" at root
      const rootChild = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Child\n\nRoot child.',
        inserter: 'test-user'
      })

      // A note "child" inside collection "test"
      const nestedChild = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Child\n\nNested child.',
        inserter: 'test-user',
        collection_id: testCollection.collection_uuid
      })

      await indexAll(localDb)

      // Resolve ['child'] → root note
      const rootResult = await resolveSlugPath(localDb, ['child'], library.collection_uuid)
      expect(rootResult).not.toBeNull()
      expect(rootResult!.type).toBe('note')
      expect(rootResult!.entity.block_uuid).toBe(rootChild.block_uuid)

      // Resolve ['test', 'child'] → nested note
      const nestedResult = await resolveSlugPath(localDb, ['test', 'child'], library.collection_uuid)
      expect(nestedResult).not.toBeNull()
      expect(nestedResult!.type).toBe('note')
      expect(nestedResult!.entity.block_uuid).toBe(nestedChild.block_uuid)
    })

    test('getSlugPath builds full path for a collection', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const cooking = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const italian = await createCollection(syncedDb, {
        title: 'Italian',
        parent_collection_uuid: cooking.collection_uuid,
        inserter: 'test-user'
      })

      const slugPath = await getSlugPath(localDb, italian.collection_uuid)
      expect(slugPath).toEqual(['cooking', 'italian'])
    })

    test('getNoteSlugPath builds full path for a note', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const cooking = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const italian = await createCollection(syncedDb, {
        title: 'Italian',
        parent_collection_uuid: cooking.collection_uuid,
        inserter: 'test-user'
      })

      const pasta = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Pasta\n\nPasta recipe.',
        inserter: 'test-user',
        collection_id: italian.collection_uuid
      })

      // Index to create slug entries
      await indexAll(localDb)

      const slugPath = await getNoteSlugPath(localDb, pasta.block_uuid)
      expect(slugPath).toEqual(['cooking', 'italian', 'pasta'])
    })
  })

  describe('resolveSlugPathPartial', () => {
    test('returns parentExists=true when only the final segment is missing', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const cooking = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      await indexAll(localDb)

      // 'cooking' exists, 'new-recipe' does not
      const result = await resolveSlugPathPartial(localDb, ['cooking', 'new-recipe'], library.collection_uuid)

      expect(result.parentExists).toBe(true)
      expect(result.resolvedSegments).toEqual(['cooking'])
      expect(result.resolvedCollections).toHaveLength(1)
      expect(result.resolvedCollections[0].collection_uuid).toBe(cooking.collection_uuid)
      expect(result.missingSegments).toEqual(['new-recipe'])
      expect(result.parentUuid).toBe(cooking.collection_uuid)
    })

    test('returns parentExists=true for single segment (parent is library root)', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      await indexAll(localDb)

      const result = await resolveSlugPathPartial(localDb, ['new-thing'], library.collection_uuid)

      expect(result.parentExists).toBe(true)
      expect(result.resolvedSegments).toEqual([])
      expect(result.resolvedCollections).toHaveLength(0)
      expect(result.missingSegments).toEqual(['new-thing'])
      expect(result.parentUuid).toBe(library.collection_uuid)
    })

    test('returns parentExists=false when intermediate collections are missing', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      await indexAll(localDb)

      // Neither 'cooking' nor 'italian' nor 'pasta' exist
      const result = await resolveSlugPathPartial(localDb, ['cooking', 'italian', 'pasta'], library.collection_uuid)

      expect(result.parentExists).toBe(false)
      expect(result.resolvedSegments).toEqual([])
      expect(result.resolvedCollections).toHaveLength(0)
      expect(result.missingSegments).toEqual(['cooking', 'italian', 'pasta'])
      expect(result.parentUuid).toBe(library.collection_uuid)
    })

    test('returns parentExists=false when some but not all parents exist', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const cooking = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      await indexAll(localDb)

      // 'cooking' exists, but 'italian' and 'pasta' do not
      const result = await resolveSlugPathPartial(localDb, ['cooking', 'italian', 'pasta'], library.collection_uuid)

      expect(result.parentExists).toBe(false)
      expect(result.resolvedSegments).toEqual(['cooking'])
      expect(result.resolvedCollections).toHaveLength(1)
      expect(result.resolvedCollections[0].collection_uuid).toBe(cooking.collection_uuid)
      expect(result.missingSegments).toEqual(['italian', 'pasta'])
      expect(result.parentUuid).toBe(cooking.collection_uuid)
    })

    test('returns empty missingSegments when all segments resolve', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const cooking = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const italian = await createCollection(syncedDb, {
        title: 'Italian',
        parent_collection_uuid: cooking.collection_uuid,
        inserter: 'test-user'
      })

      await indexAll(localDb)

      const result = await resolveSlugPathPartial(localDb, ['cooking', 'italian'], library.collection_uuid)

      expect(result.parentExists).toBe(true)
      expect(result.resolvedSegments).toEqual(['cooking', 'italian'])
      expect(result.resolvedCollections).toHaveLength(2)
      expect(result.missingSegments).toEqual([])
      expect(result.parentUuid).toBe(italian.collection_uuid)
    })

    test('correctly identifies deeply nested missing parents', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const a = await createCollection(syncedDb, {
        title: 'A',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const b = await createCollection(syncedDb, {
        title: 'B',
        parent_collection_uuid: a.collection_uuid,
        inserter: 'test-user'
      })

      await indexAll(localDb)

      // a/b exist, but c/d/e do not
      const result = await resolveSlugPathPartial(localDb, ['a', 'b', 'c', 'd', 'e'], library.collection_uuid)

      expect(result.parentExists).toBe(false)
      expect(result.resolvedSegments).toEqual(['a', 'b'])
      expect(result.resolvedCollections).toHaveLength(2)
      expect(result.missingSegments).toEqual(['c', 'd', 'e'])
      expect(result.parentUuid).toBe(b.collection_uuid)
    })
  })

  describe('Move Operations', () => {
    test('moveNote moves a note from one collection to another', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const collectionA = await createCollection(syncedDb, {
        title: 'Collection A',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const collectionB = await createCollection(syncedDb, {
        title: 'Collection B',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Test Note\n\nSome content.',
        inserter: 'test-user',
        collection_id: collectionA.collection_uuid
      })

      // Verify note is initially in collection A
      const notesInA = await getNotesInCollection(syncedDb, collectionA.collection_uuid)
      expect(notesInA.length).toBe(1)
      expect(notesInA[0].block_uuid).toBe(note.block_uuid)

      // Move note to collection B
      const movedNote = await moveNote(syncedDb, note.block_uuid, collectionB.collection_uuid, 'test-user')
      expect(movedNote.collection_id).toBe(collectionB.collection_uuid)
      expect(movedNote.body).toBe('# Test Note\n\nSome content.')

      // Verify note is now in collection B (latest version)
      const latest = await getLatestNoteVersion(syncedDb, note.block_uuid)
      expect(latest).not.toBeNull()
      expect(latest!.collection_id).toBe(collectionB.collection_uuid)
    })

    test('moveNote moves a note to library root (collection_id = null)', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const collection = await createCollection(syncedDb, {
        title: 'Collection A',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Root Note\n\nContent.',
        inserter: 'test-user',
        collection_id: collection.collection_uuid
      })

      // Move note to library root
      const movedNote = await moveNote(syncedDb, note.block_uuid, null, 'test-user')
      expect(movedNote.collection_id).toBeNull()

      // Verify latest version is at root
      const latest = await getLatestNoteVersion(syncedDb, note.block_uuid)
      expect(latest!.collection_id).toBeNull()
    })

    test('moveNote throws when note does not exist', async () => {
      await expect(
        moveNote(syncedDb, 'nonexistent-uuid', null, 'test-user')
      ).rejects.toThrow('Note not found')
    })

    test('moveCollection moves a collection to a new parent', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const parentA = await createCollection(syncedDb, {
        title: 'Parent A',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const parentB = await createCollection(syncedDb, {
        title: 'Parent B',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const child = await createCollection(syncedDb, {
        title: 'Child Collection',
        parent_collection_uuid: parentA.collection_uuid,
        inserter: 'test-user'
      })

      // Verify child is initially under parent A
      const childrenOfA = await getChildCollections(syncedDb, parentA.collection_uuid)
      expect(childrenOfA.length).toBe(1)
      expect(childrenOfA[0].collection_uuid).toBe(child.collection_uuid)

      // Move child to parent B
      await moveCollection(syncedDb, child.collection_uuid, parentB.collection_uuid)

      // Verify child is now under parent B
      const childrenOfAAfter = await getChildCollections(syncedDb, parentA.collection_uuid)
      expect(childrenOfAAfter.length).toBe(0)

      const childrenOfB = await getChildCollections(syncedDb, parentB.collection_uuid)
      expect(childrenOfB.length).toBe(1)
      expect(childrenOfB[0].collection_uuid).toBe(child.collection_uuid)
    })

    test('moveCollection moves a collection to library root', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const parent = await createCollection(syncedDb, {
        title: 'Parent',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const child = await createCollection(syncedDb, {
        title: 'Nested Collection',
        parent_collection_uuid: parent.collection_uuid,
        inserter: 'test-user'
      })

      // Move to library root
      await moveCollection(syncedDb, child.collection_uuid, library.collection_uuid)

      // Verify child is now directly under library
      const topLevel = await getChildCollections(syncedDb, library.collection_uuid)
      const uuids = topLevel.map(c => c.collection_uuid)
      expect(uuids).toContain(child.collection_uuid)
      expect(uuids).toContain(parent.collection_uuid)
    })

    test('move operations update slug paths after re-indexing', async () => {
      const library = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const cooking = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const recipes = await createCollection(syncedDb, {
        title: 'Recipes',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const italian = await createCollection(syncedDb, {
        title: 'Italian',
        parent_collection_uuid: cooking.collection_uuid,
        inserter: 'test-user'
      })

      await indexAll(localDb)

      // Verify initial slug path: cooking/italian
      const initialPath = await getSlugPath(syncedDb, italian.collection_uuid)
      expect(initialPath).toEqual(['cooking', 'italian'])

      // Move italian under recipes
      await moveCollection(syncedDb, italian.collection_uuid, recipes.collection_uuid)
      await indexAll(localDb)

      // Verify new slug path: recipes/italian
      const newPath = await getSlugPath(syncedDb, italian.collection_uuid)
      expect(newPath).toEqual(['recipes', 'italian'])

      // Verify slug resolution works with new path
      const resolved = await resolveSlugPath(localDb, ['recipes', 'italian'], library.collection_uuid)
      expect(resolved).not.toBeNull()
      expect(resolved!.type).toBe('collection')
      expect(resolved!.entity.collection_uuid).toBe(italian.collection_uuid)
    })
  })
})
