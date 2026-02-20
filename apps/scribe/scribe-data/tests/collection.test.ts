import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { up, down } from '../src/migrations.js'
import { createTestDB } from './test-utils.js'
import {
  createCollection,
  getCollectionByUuid,
  getAllCollections,
  getRootCollection,
  getBlocksInCollection,
  getStreamDisplayName
} from '../src/collection.js'
import { createBlock, createBlockVersion } from '../src/block.js'
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

  describe('Root Collection', () => {
    test('getRootCollection returns null when no root collection exists', async () => {
      const root = await getRootCollection(syncedDb)
      expect(root).toBeNull()
    })

    test('should create a root collection (parent_collection_uuid = null)', async () => {
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

    test('getRootCollection returns the root collection after creation', async () => {
      const created = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const root = await getRootCollection(syncedDb)

      expect(root).toBeDefined()
      expect(root?.collection_uuid).toBe(created.collection_uuid)
      expect(root?.title).toBe('My Stream')
    })

    test('getRootCollection works via TributaryLocal (for listing)', async () => {
      const created = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      // localDb shares the same schema, so getRootCollection should work
      const root = await getRootCollection(localDb)

      expect(root).toBeDefined()
      expect(root?.collection_uuid).toBe(created.collection_uuid)
      expect(root?.title).toBe('My Stream')
    })

    test('getRootCollection via TributaryLocal returns null when no root exists', async () => {
      const root = await getRootCollection(localDb)
      expect(root).toBeNull()
    })

    test('should enforce at most one root collection (constraint)', async () => {
      await createCollection(syncedDb, {
        title: 'First Root',
        inserter: 'test-user'
      })

      // Attempting to create a second root collection should fail
      await expect(
        createCollection(syncedDb, {
          title: 'Second Root',
          inserter: 'test-user'
        })
      ).rejects.toThrow()
    })

    test('should allow creating a root collection with a specified UUID', async () => {
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
    test('should create a named collection under the root', async () => {
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

    test('should create multiple named collections under the root', async () => {
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

    test('should return empty array when only root collection exists', async () => {
      await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const collections = await getAllCollections(syncedDb)
      expect(collections).toEqual([])
    })

    test('should return named collections (not the root)', async () => {
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
      // Root should not be included
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

  describe('Block-Collection Relationship', () => {
    test('blocks without collection_id belong to root collection (null)', async () => {
      const block = await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Root Block\n\nThis block belongs to the root collection.',
        inserter: 'test-user'
      })

      expect(block.collection_id).toBeNull()
    })

    test('should create a block assigned to a named collection', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const block = await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Gumbo\n\nA classic cajun dish.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      expect(block.collection_id).toBe(cajun.collection_uuid)
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

      const block = await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Gumbo\n\nOriginal recipe.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      const updatedBlock = await createBlockVersion(syncedDb, block.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Gumbo\n\nUpdated recipe with more spice.',
        inserter: 'test-user'
      })

      expect(updatedBlock.collection_id).toBe(cajun.collection_uuid)
    })

    test('should allow moving a block to a different collection via new version', async () => {
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

      const block = await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Bread Pudding\n\nIs it cajun or dessert?',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      expect(block.collection_id).toBe(cajun.collection_uuid)

      const moved = await createBlockVersion(syncedDb, block.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Bread Pudding\n\nIs it cajun or dessert?',
        inserter: 'test-user',
        collection_id: desserts.collection_uuid
      })

      expect(moved.collection_id).toBe(desserts.collection_uuid)
    })

    test('should allow removing a block from a collection (move to root)', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const block = await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Misplaced Note\n\nThis does not belong here.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      const moved = await createBlockVersion(syncedDb, block.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Misplaced Note\n\nThis does not belong here.',
        inserter: 'test-user',
        collection_id: null
      })

      expect(moved.collection_id).toBeNull()
    })
  })

  describe('getBlocksInCollection', () => {
    test('should return root-level blocks (collection_id IS NULL)', async () => {
      await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Root Block A\n\nFirst root block.',
        inserter: 'test-user'
      })

      await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Root Block B\n\nSecond root block.',
        inserter: 'test-user'
      })

      const blocks = await getBlocksInCollection(syncedDb, null)

      expect(blocks).toHaveLength(2)
    })

    test('should return blocks in a named collection', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Gumbo\n\nA classic cajun stew.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Jambalaya\n\nRice-based cajun dish.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      // Also create a root block that should NOT appear
      await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Random Note\n\nNot in cajun.',
        inserter: 'test-user'
      })

      const cajunBlocks = await getBlocksInCollection(syncedDb, cajun.collection_uuid)

      expect(cajunBlocks).toHaveLength(2)
      expect(cajunBlocks.every(b => b.collection_id === cajun.collection_uuid)).toBe(true)
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

      const blocks = await getBlocksInCollection(syncedDb, empty.collection_uuid)
      expect(blocks).toEqual([])
    })

    test('should return only the latest version of each block', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Stream',
        inserter: 'test-user'
      })

      const cajun = await createCollection(syncedDb, {
        title: 'Cajun Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const block = await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Gumbo v1\n\nOriginal.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      await createBlockVersion(syncedDb, block.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Gumbo v2\n\nUpdated.',
        inserter: 'test-user'
      })

      const blocks = await getBlocksInCollection(syncedDb, cajun.collection_uuid)

      expect(blocks).toHaveLength(1)
      expect(blocks[0].body).toContain('Gumbo v2')
    })
  })

  describe('Stream Structure (per docs)', () => {
    test('should model the example structure from the docs', async () => {
      // Stream (root collection)
      // ├── block-a               (root-level block, collection_id = null)
      // ├── block-b               (root-level block, collection_id = null)
      // ├── cajun-recipes/         (named collection)
      // │   ├── gumbo             (block in collection)
      // │   └── jambalaya         (block in collection)
      // └── desserts/              (named collection)
      //     └── chocolate-cake    (block in collection)

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

      await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Block A\n\nRoot-level block.',
        inserter: 'test-user'
      })

      await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Block B\n\nAnother root-level block.',
        inserter: 'test-user'
      })

      await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Gumbo\n\nA classic cajun stew.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Jambalaya\n\nRice-based cajun dish.',
        inserter: 'test-user',
        collection_id: cajun.collection_uuid
      })

      await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Chocolate Cake\n\nA rich chocolate dessert.',
        inserter: 'test-user',
        collection_id: desserts.collection_uuid
      })

      // Verify root collection
      const rootCol = await getRootCollection(syncedDb)
      expect(rootCol?.title).toBe('My Cookbook Stream')

      // Verify named collections
      const collections = await getAllCollections(syncedDb)
      expect(collections).toHaveLength(2)

      // Verify blocks per collection using getBlocksInCollection
      const rootBlocks = await getBlocksInCollection(syncedDb, null)
      expect(rootBlocks).toHaveLength(2)

      const cajunBlocks = await getBlocksInCollection(syncedDb, cajun.collection_uuid)
      expect(cajunBlocks).toHaveLength(2)

      const dessertBlocks = await getBlocksInCollection(syncedDb, desserts.collection_uuid)
      expect(dessertBlocks).toHaveLength(1)
    })
  })

  describe('Default Collection Behavior', () => {
    test('stream with no root collection implies "Notes"', async () => {
      // Before creating a root collection, getRootCollection returns null
      const root = await getRootCollection(syncedDb)
      expect(root).toBeNull()

      // Blocks can still be created — they belong to the implied root
      const block = await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# My Note\n\nJust a regular note.',
        inserter: 'test-user'
      })

      expect(block.collection_id).toBeNull()

      // No collections in the table
      const collections = await getAllCollections(syncedDb)
      expect(collections).toHaveLength(0)

      // Root blocks can still be queried
      const rootBlocks = await getBlocksInCollection(syncedDb, null)
      expect(rootBlocks).toHaveLength(1)
    })
  })

  describe('getStreamDisplayName', () => {
    test('returns null when no root collection exists (via TributaryStream)', async () => {
      const name = await getStreamDisplayName(syncedDb)
      expect(name).toBeNull()
    })

    test('returns null when no root collection exists (via TributaryLocal)', async () => {
      const name = await getStreamDisplayName(localDb)
      expect(name).toBeNull()
    })

    test('returns root collection title when one exists (via TributaryStream)', async () => {
      await createCollection(syncedDb, {
        title: 'My Cookbook',
        inserter: 'test-user'
      })

      const name = await getStreamDisplayName(syncedDb)
      expect(name).toBe('My Cookbook')
    })

    test('returns root collection title when one exists (via TributaryLocal)', async () => {
      await createCollection(syncedDb, {
        title: 'My Cookbook',
        inserter: 'test-user'
      })

      const name = await getStreamDisplayName(localDb)
      expect(name).toBe('My Cookbook')
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

    test('named collections are direct children of the root (one level deep)', async () => {
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
