import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { up } from '../src/migrations.js'
import { createCollection, createCollections } from '../src/collection.js'
import { createImageBlocks } from '../src/image.js'
import { createNotes } from '../src/note.js'
import { createTestDB } from './test-utils.js'
import { TributaryStream, TributaryLocal, FakeServer } from 'tributary-client'

describe('batch create operations', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let server: FakeServer
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    server = result.server
    cleanup = async () => {}
    await up(syncedDb, localDb)
  })

  afterEach(async () => {
    if (cleanup) await cleanup()
  })

  describe('createCollections', () => {
    test('creates multiple collections in a single stream entry', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user',
      })

      const blobsBefore = server.getAllBlobs().length

      const collections = await createCollections(syncedDb, [
        { title: 'Recipes', parent_collection_uuid: root.collection_uuid, inserter: 'test-user' },
        { title: 'Photos', parent_collection_uuid: root.collection_uuid, inserter: 'test-user' },
        { title: 'Notes', parent_collection_uuid: root.collection_uuid, inserter: 'test-user' },
      ])

      const blobsAfter = server.getAllBlobs().length

      // All three collections created in exactly one stream entry
      expect(blobsAfter - blobsBefore).toBe(1)

      expect(collections).toHaveLength(3)
      expect(collections[0].title).toBe('Recipes')
      expect(collections[1].title).toBe('Photos')
      expect(collections[2].title).toBe('Notes')
      expect(collections[0].slug).toBe('recipes')
      expect(collections[1].slug).toBe('photos')
      expect(collections[2].slug).toBe('notes')
    })

    test('returns empty array for empty input', async () => {
      const blobsBefore = server.getAllBlobs().length
      const result = await createCollections(syncedDb, [])
      const blobsAfter = server.getAllBlobs().length

      expect(result).toEqual([])
      expect(blobsAfter - blobsBefore).toBe(0)
    })

    test('single item batch behaves like createCollection', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user',
      })

      const blobsBefore = server.getAllBlobs().length

      const [col] = await createCollections(syncedDb, [
        { title: 'Recipes', parent_collection_uuid: root.collection_uuid, inserter: 'test-user', slug: 'custom-slug' },
      ])

      const blobsAfter = server.getAllBlobs().length
      expect(blobsAfter - blobsBefore).toBe(1)

      expect(col.title).toBe('Recipes')
      expect(col.slug).toBe('custom-slug')
      expect(col.parent_collection_uuid).toBe(root.collection_uuid)
    })

    test('respects explicit collection_uuid', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user',
      })

      const uuid1 = 'aaaaaaaa-1111-4000-8000-000000000001'
      const uuid2 = 'aaaaaaaa-1111-4000-8000-000000000002'

      const collections = await createCollections(syncedDb, [
        { collection_uuid: uuid1, title: 'A', parent_collection_uuid: root.collection_uuid, inserter: 'test-user' },
        { collection_uuid: uuid2, title: 'B', parent_collection_uuid: root.collection_uuid, inserter: 'test-user' },
      ])

      expect(collections[0].collection_uuid).toBe(uuid1)
      expect(collections[1].collection_uuid).toBe(uuid2)
    })
  })

  describe('createNotes', () => {
    test('creates multiple notes in a single stream entry', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user',
      })

      const blobsBefore = server.getAllBlobs().length

      const notes = await createNotes(syncedDb, [
        { block_type: 'scribe/markdown', body: '# Note A\n\nFirst.', inserter: 'test-user', slug: 'note-a' },
        { block_type: 'scribe/markdown', body: '# Note B\n\nSecond.', inserter: 'test-user', slug: 'note-b' },
        { block_type: 'scribe/markdown', body: '# Note C\n\nThird.', inserter: 'test-user', slug: 'note-c' },
      ])

      const blobsAfter = server.getAllBlobs().length

      expect(blobsAfter - blobsBefore).toBe(1)

      expect(notes).toHaveLength(3)
      expect(notes[0].slug).toBe('note-a')
      expect(notes[1].slug).toBe('note-b')
      expect(notes[2].slug).toBe('note-c')
      // All should have library root as collection_id
      for (const n of notes) {
        expect(n.collection_id).toBe(root.collection_uuid)
      }
    })

    test('returns empty array for empty input', async () => {
      const blobsBefore = server.getAllBlobs().length
      const result = await createNotes(syncedDb, [])
      const blobsAfter = server.getAllBlobs().length

      expect(result).toEqual([])
      expect(blobsAfter - blobsBefore).toBe(0)
    })

    test('resolves library root once for all notes', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user',
      })

      const notes = await createNotes(syncedDb, [
        { block_type: 'scribe/markdown', body: '# A', inserter: 'test-user', slug: 'a' },
        { block_type: 'scribe/markdown', body: '# B', inserter: 'test-user', slug: 'b' },
      ])

      expect(notes[0].collection_id).toBe(root.collection_uuid)
      expect(notes[1].collection_id).toBe(root.collection_uuid)
    })

    test('respects explicit collection_id per note', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user',
      })

      const col = await createCollection(syncedDb, {
        title: 'Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user',
      })

      const notes = await createNotes(syncedDb, [
        { block_type: 'scribe/markdown', body: '# In library', inserter: 'test-user', slug: 'in-lib' },
        { block_type: 'scribe/markdown', body: '# In recipes', inserter: 'test-user', slug: 'in-recipes', collection_id: col.collection_uuid },
      ])

      expect(notes[0].collection_id).toBe(root.collection_uuid)
      expect(notes[1].collection_id).toBe(col.collection_uuid)
    })
  })

  describe('createImageBlocks', () => {
    test('creates multiple image blocks in a single stream entry', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user',
      })

      const blobsBefore = server.getAllBlobs().length

      const images = await createImageBlocks(syncedDb, [
        { blobHash: 'hash-a', contentType: 'image/png', slug: 'alpha', inserter: 'test-user', collectionId: root.collection_uuid },
        { blobHash: 'hash-b', contentType: 'image/jpeg', slug: 'beta', title: 'Beta', inserter: 'test-user', collectionId: root.collection_uuid },
        { blobHash: 'hash-c', contentType: 'image/webp', slug: 'gamma', width: 1920, height: 1080, inserter: 'test-user', collectionId: root.collection_uuid },
      ])

      const blobsAfter = server.getAllBlobs().length

      expect(blobsAfter - blobsBefore).toBe(1)

      expect(images).toHaveLength(3)
      expect(images[0].slug).toBe('alpha')
      expect(images[1].slug).toBe('beta')
      expect(images[2].slug).toBe('gamma')

      for (const img of images) {
        expect(img.block_type).toBe('scribe/image')
        expect(img.collection_id).toBe(root.collection_uuid)
      }

      // Verify body JSON
      const body0 = JSON.parse(images[0].body)
      expect(body0.blobHash).toBe('hash-a')
      expect(body0.contentType).toBe('image/png')

      const body1 = JSON.parse(images[1].body)
      expect(body1.title).toBe('Beta')

      const body2 = JSON.parse(images[2].body)
      expect(body2.width).toBe(1920)
      expect(body2.height).toBe(1080)
    })

    test('returns empty array for empty input', async () => {
      const blobsBefore = server.getAllBlobs().length
      const result = await createImageBlocks(syncedDb, [])
      const blobsAfter = server.getAllBlobs().length

      expect(result).toEqual([])
      expect(blobsAfter - blobsBefore).toBe(0)
    })
  })

  describe('bulk image operations use single stream entries', () => {
    test('ensureBulkCollections creates all collections in one stream entry', async () => {
      const { ensureBulkCollections } = await import('../src/bulkImage.js')

      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user',
      })

      const plan = {
        collections: [
          { folderPath: 'photos', title: 'Photos', slug: 'photos', parentFolderPath: null },
          { folderPath: 'photos/vacation', title: 'Vacation', slug: 'vacation', parentFolderPath: 'photos' },
          { folderPath: 'docs', title: 'Docs', slug: 'docs', parentFolderPath: null },
        ],
        images: [],
        rootCollectionId: root.collection_uuid,
      }

      const blobsBefore = server.getAllBlobs().length

      const collectionMap = await ensureBulkCollections(syncedDb, plan, 'test-user')

      const blobsAfter = server.getAllBlobs().length
      expect(blobsAfter - blobsBefore).toBe(1)

      expect(collectionMap.size).toBe(3)
      expect(collectionMap.has('photos')).toBe(true)
      expect(collectionMap.has('photos/vacation')).toBe(true)
      expect(collectionMap.has('docs')).toBe(true)
    })

    test('createBulkImageBlocks creates all images in one stream entry', async () => {
      const { createBulkImageBlocks } = await import('../src/bulkImage.js')

      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user',
      })

      const plan = {
        collections: [],
        images: [
          { blobHash: 'h1', contentType: 'image/png', fileName: 'a.png', slug: 'a', folderPath: '' },
          { blobHash: 'h2', contentType: 'image/jpeg', fileName: 'b.jpg', slug: 'b', folderPath: '' },
          { blobHash: 'h3', contentType: 'image/webp', fileName: 'c.webp', slug: 'c', folderPath: '' },
        ],
        rootCollectionId: root.collection_uuid,
      }

      const collectionMap = new Map<string, string>()

      const blobsBefore = server.getAllBlobs().length

      const blocks = await createBulkImageBlocks(syncedDb, plan, collectionMap, 'test-user')

      const blobsAfter = server.getAllBlobs().length
      expect(blobsAfter - blobsBefore).toBe(1)

      expect(blocks).toHaveLength(3)
    })
  })
})
