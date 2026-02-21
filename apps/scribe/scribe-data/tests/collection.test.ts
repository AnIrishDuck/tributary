import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { up, down } from '../src/migrations.js'
import { createTestDB } from './test-utils.js'
import {
  createCollection,
  getCollectionByUuid,
  getAllCollections,
  getLinkedLibraries,
  getLibrary,
  getNotesInCollection,
  getLibraryDisplayName
} from '../src/collection.js'
import { createNote, createNoteVersion } from '../src/note.js'
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

  describe('Nesting (Not Yet Supported)', () => {
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
  })
})
