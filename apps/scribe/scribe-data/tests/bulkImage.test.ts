import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { up } from '../src/migrations.js'
import {
  ensureBulkCollections,
  createBulkImageBlocks,
  validateBulkUploadPlan,
  type BulkUploadPlan,
} from '../src/bulkImage.js'
import { parseImageBlockBody, getImageBySlug } from '../src/image.js'
import { getCollectionByUuid } from '../src/collection.js'
import { indexAll, isValidSlug } from '../src/indexing.js'
import { createCollection } from '../src/collection.js'
import { createTestDB } from './test-utils.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'

describe('bulk image upload', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let cleanup: () => Promise<void>
  let rootCollectionId: string

  beforeEach(async () => {
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    cleanup = async () => {}
    await up(syncedDb, localDb)

    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user',
    })
    rootCollectionId = root.collection_uuid
  })

  afterEach(async () => {
    if (cleanup) await cleanup()
  })

  test('flat upload: multiple images with no subfolders', async () => {
    const plan: BulkUploadPlan = {
      collections: [],
      images: [
        { blobHash: 'hash-a', contentType: 'image/png', fileName: 'alpha.png', slug: 'alpha', folderPath: '' },
        { blobHash: 'hash-b', contentType: 'image/jpeg', fileName: 'beta.jpg', slug: 'beta', title: 'Beta Image', folderPath: '' },
        { blobHash: 'hash-c', contentType: 'image/webp', fileName: 'gamma.webp', slug: 'gamma', width: 1920, height: 1080, folderPath: '' },
      ],
      rootCollectionId,
    }

    const collectionMap = await ensureBulkCollections(syncedDb, plan, 'test-user')
    expect(collectionMap.size).toBe(0)

    const blocks = await createBulkImageBlocks(syncedDb, plan, collectionMap, 'test-user')
    expect(blocks).toHaveLength(3)

    expect(blocks[0].slug).toBe('alpha')
    expect(blocks[1].slug).toBe('beta')
    expect(blocks[2].slug).toBe('gamma')

    // All assigned to root collection
    for (const block of blocks) {
      expect(block.collection_id).toBe(rootCollectionId)
      expect(block.block_type).toBe('scribe/image')
    }

    // Verify body parsing
    const body0 = parseImageBlockBody(blocks[0])
    expect(body0.blobHash).toBe('hash-a')
    expect(body0.contentType).toBe('image/png')

    const body2 = parseImageBlockBody(blocks[2])
    expect(body2.width).toBe(1920)
    expect(body2.height).toBe(1080)
  })

  test('nested folders: creates collections in parent-first order', async () => {
    const plan: BulkUploadPlan = {
      collections: [
        { folderPath: 'photos', title: 'Photos', slug: 'photos', parentFolderPath: null },
        { folderPath: 'photos/vacation', title: 'Vacation', slug: 'vacation', parentFolderPath: 'photos' },
      ],
      images: [
        { blobHash: 'hash-1', contentType: 'image/png', fileName: 'beach.png', slug: 'beach', folderPath: 'photos/vacation' },
      ],
      rootCollectionId,
    }

    const collectionMap = await ensureBulkCollections(syncedDb, plan, 'test-user')
    expect(collectionMap.size).toBe(2)
    expect(collectionMap.has('photos')).toBe(true)
    expect(collectionMap.has('photos/vacation')).toBe(true)

    // Verify parent-child relationships
    const photosUuid = collectionMap.get('photos')!
    const vacationUuid = collectionMap.get('photos/vacation')!

    const photosCol = await getCollectionByUuid(syncedDb, photosUuid)
    expect(photosCol).not.toBeNull()
    expect(photosCol!.parent_collection_uuid).toBe(rootCollectionId)

    const vacationCol = await getCollectionByUuid(syncedDb, vacationUuid)
    expect(vacationCol).not.toBeNull()
    expect(vacationCol!.parent_collection_uuid).toBe(photosUuid)
  })

  test('images assigned to correct collections based on folder path', async () => {
    const plan: BulkUploadPlan = {
      collections: [
        { folderPath: 'animals', title: 'Animals', slug: 'animals', parentFolderPath: null },
      ],
      images: [
        { blobHash: 'hash-root', contentType: 'image/png', fileName: 'logo.png', slug: 'logo', folderPath: '' },
        { blobHash: 'hash-sub', contentType: 'image/jpeg', fileName: 'cat.jpg', slug: 'cat', folderPath: 'animals' },
      ],
      rootCollectionId,
    }

    const collectionMap = await ensureBulkCollections(syncedDb, plan, 'test-user')
    const blocks = await createBulkImageBlocks(syncedDb, plan, collectionMap, 'test-user')

    expect(blocks[0].collection_id).toBe(rootCollectionId)
    expect(blocks[1].collection_id).toBe(collectionMap.get('animals'))
  })

  test('empty collections list: images go to root collection', async () => {
    const plan: BulkUploadPlan = {
      collections: [],
      images: [
        { blobHash: 'hash-only', contentType: 'image/png', fileName: 'solo.png', slug: 'solo', folderPath: '' },
      ],
      rootCollectionId,
    }

    const collectionMap = await ensureBulkCollections(syncedDb, plan, 'test-user')
    expect(collectionMap.size).toBe(0)

    const blocks = await createBulkImageBlocks(syncedDb, plan, collectionMap, 'test-user')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].collection_id).toBe(rootCollectionId)
  })

  test('indexAll succeeds after bulk creation and images are resolvable by slug', async () => {
    const plan: BulkUploadPlan = {
      collections: [
        { folderPath: 'pics', title: 'Pics', slug: 'pics', parentFolderPath: null },
      ],
      images: [
        { blobHash: 'hash-x', contentType: 'image/png', fileName: 'sunset.png', slug: 'sunset', folderPath: '' },
        { blobHash: 'hash-y', contentType: 'image/jpeg', fileName: 'dawn.jpg', slug: 'dawn', folderPath: 'pics' },
      ],
      rootCollectionId,
    }

    const collectionMap = await ensureBulkCollections(syncedDb, plan, 'test-user')
    await createBulkImageBlocks(syncedDb, plan, collectionMap, 'test-user')

    const result = await indexAll(localDb)
    expect(result.indexedCount).toBeGreaterThanOrEqual(2)

    // Resolve root-level image by slug
    const sunsetImg = await getImageBySlug(localDb, 'sunset', rootCollectionId)
    expect(sunsetImg).not.toBeNull()
    expect(sunsetImg!.body.blobHash).toBe('hash-x')

    // Resolve sub-collection image by slug
    const picsUuid = collectionMap.get('pics')!
    const dawnImg = await getImageBySlug(localDb, 'dawn', picsUuid)
    expect(dawnImg).not.toBeNull()
    expect(dawnImg!.body.blobHash).toBe('hash-y')
  })

  test('mixed depths: a/, a/b/, c/ with images at various levels', async () => {
    const plan: BulkUploadPlan = {
      collections: [
        { folderPath: 'a', title: 'A', slug: 'a', parentFolderPath: null },
        { folderPath: 'a/b', title: 'B', slug: 'b', parentFolderPath: 'a' },
        { folderPath: 'c', title: 'C', slug: 'c', parentFolderPath: null },
      ],
      images: [
        { blobHash: 'h1', contentType: 'image/png', fileName: 'root-img.png', slug: 'root-img', folderPath: '' },
        { blobHash: 'h2', contentType: 'image/png', fileName: 'a-img.png', slug: 'a-img', folderPath: 'a' },
        { blobHash: 'h3', contentType: 'image/png', fileName: 'ab-img.png', slug: 'ab-img', folderPath: 'a/b' },
        { blobHash: 'h4', contentType: 'image/png', fileName: 'c-img.png', slug: 'c-img', folderPath: 'c' },
      ],
      rootCollectionId,
    }

    const collectionMap = await ensureBulkCollections(syncedDb, plan, 'test-user')
    expect(collectionMap.size).toBe(3)

    // Verify collection hierarchy
    const aCol = await getCollectionByUuid(syncedDb, collectionMap.get('a')!)
    const bCol = await getCollectionByUuid(syncedDb, collectionMap.get('a/b')!)
    const cCol = await getCollectionByUuid(syncedDb, collectionMap.get('c')!)

    expect(aCol!.parent_collection_uuid).toBe(rootCollectionId)
    expect(bCol!.parent_collection_uuid).toBe(collectionMap.get('a'))
    expect(cCol!.parent_collection_uuid).toBe(rootCollectionId)

    // Verify image assignments
    const blocks = await createBulkImageBlocks(syncedDb, plan, collectionMap, 'test-user')
    expect(blocks).toHaveLength(4)

    expect(blocks[0].collection_id).toBe(rootCollectionId)
    expect(blocks[1].collection_id).toBe(collectionMap.get('a'))
    expect(blocks[2].collection_id).toBe(collectionMap.get('a/b'))
    expect(blocks[3].collection_id).toBe(collectionMap.get('c'))

    // Verify indexing works
    await indexAll(localDb)

    const rootImg = await getImageBySlug(localDb, 'root-img', rootCollectionId)
    expect(rootImg).not.toBeNull()

    const abImg = await getImageBySlug(localDb, 'ab-img', collectionMap.get('a/b')!)
    expect(abImg).not.toBeNull()
    expect(abImg!.body.blobHash).toBe('h3')
  })

  test('rootCollectionId null: resolves library root and creates sub-collections under it', async () => {
    const plan: BulkUploadPlan = {
      collections: [
        { folderPath: 'photos', title: 'Photos', slug: 'photos', parentFolderPath: null },
      ],
      images: [
        { blobHash: 'hash-root', contentType: 'image/png', fileName: 'logo.png', slug: 'logo', folderPath: '' },
        { blobHash: 'hash-sub', contentType: 'image/jpeg', fileName: 'beach.jpg', slug: 'beach', folderPath: 'photos' },
      ],
      rootCollectionId: null,
    }

    const collectionMap = await ensureBulkCollections(syncedDb, plan, 'test-user')
    expect(collectionMap.size).toBe(1)

    // The "photos" collection should be a child of the library root, not a new root
    const photosUuid = collectionMap.get('photos')!
    const photosCol = await getCollectionByUuid(syncedDb, photosUuid)
    expect(photosCol).not.toBeNull()
    expect(photosCol!.parent_collection_uuid).toBe(rootCollectionId)

    // Images should also be assigned correctly
    const blocks = await createBulkImageBlocks(syncedDb, plan, collectionMap, 'test-user')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].collection_id).toBe(rootCollectionId)
    expect(blocks[1].collection_id).toBe(photosUuid)
  })
})

describe('isValidSlug', () => {
  test('accepts valid slugs', () => {
    expect(isValidSlug('hello')).toBe(true)
    expect(isValidSlug('hello-world')).toBe(true)
    expect(isValidSlug('a')).toBe(true)
    expect(isValidSlug('abc123')).toBe(true)
    expect(isValidSlug('my-photo-2024')).toBe(true)
  })

  test('rejects empty string', () => {
    expect(isValidSlug('')).toBe(false)
  })

  test('rejects slugs with uppercase', () => {
    expect(isValidSlug('Hello')).toBe(false)
    expect(isValidSlug('HELLO')).toBe(false)
  })

  test('rejects slugs with spaces', () => {
    expect(isValidSlug('hello world')).toBe(false)
  })

  test('rejects slugs with special characters', () => {
    expect(isValidSlug('hello_world')).toBe(false)
    expect(isValidSlug('hello.world')).toBe(false)
    expect(isValidSlug('hello@world')).toBe(false)
  })

  test('rejects slugs with leading or trailing hyphens', () => {
    expect(isValidSlug('-hello')).toBe(false)
    expect(isValidSlug('hello-')).toBe(false)
    expect(isValidSlug('-hello-')).toBe(false)
  })

  test('rejects slugs with consecutive hyphens', () => {
    expect(isValidSlug('hello--world')).toBe(false)
  })
})

describe('validateBulkUploadPlan', () => {
  test('valid plan returns no errors', () => {
    const plan: BulkUploadPlan = {
      collections: [
        { folderPath: 'photos', title: 'Photos', slug: 'photos', parentFolderPath: null },
      ],
      images: [
        { blobHash: 'h1', contentType: 'image/png', fileName: 'a.png', slug: 'a', title: 'A', folderPath: '' },
        { blobHash: 'h2', contentType: 'image/png', fileName: 'b.png', slug: 'b', title: 'B', folderPath: 'photos' },
      ],
      rootCollectionId: null,
    }

    const result = validateBulkUploadPlan(plan)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  test('empty plan is valid', () => {
    const plan: BulkUploadPlan = { collections: [], images: [], rootCollectionId: null }
    const result = validateBulkUploadPlan(plan)
    expect(result.valid).toBe(true)
  })

  test('flags empty image title', () => {
    const plan: BulkUploadPlan = {
      collections: [],
      images: [
        { blobHash: 'h1', contentType: 'image/png', fileName: 'a.png', slug: 'a', title: '', folderPath: '' },
      ],
      rootCollectionId: null,
    }

    const result = validateBulkUploadPlan(plan)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ type: 'image', index: 0, field: 'title' }),
    )
  })

  test('flags empty collection title', () => {
    const plan: BulkUploadPlan = {
      collections: [
        { folderPath: 'x', title: '', slug: 'x', parentFolderPath: null },
      ],
      images: [],
      rootCollectionId: null,
    }

    const result = validateBulkUploadPlan(plan)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ type: 'collection', index: 0, field: 'title' }),
    )
  })

  test('flags invalid image slug format', () => {
    const plan: BulkUploadPlan = {
      collections: [],
      images: [
        { blobHash: 'h1', contentType: 'image/png', fileName: 'a.png', slug: 'INVALID', title: 'A', folderPath: '' },
        { blobHash: 'h2', contentType: 'image/png', fileName: 'b.png', slug: 'also invalid', title: 'B', folderPath: '' },
      ],
      rootCollectionId: null,
    }

    const result = validateBulkUploadPlan(plan)
    expect(result.valid).toBe(false)
    const slugErrors = result.errors.filter(e => e.field === 'slug' && e.message === 'Invalid slug format')
    expect(slugErrors).toHaveLength(2)
  })

  test('flags invalid collection slug format', () => {
    const plan: BulkUploadPlan = {
      collections: [
        { folderPath: 'x', title: 'X', slug: '--bad--', parentFolderPath: null },
      ],
      images: [],
      rootCollectionId: null,
    }

    const result = validateBulkUploadPlan(plan)
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual(
      expect.objectContaining({ type: 'collection', index: 0, field: 'slug', message: 'Invalid slug format' }),
    )
  })

  test('reports multiple errors simultaneously', () => {
    const plan: BulkUploadPlan = {
      collections: [
        { folderPath: 'x', title: '', slug: 'BAD', parentFolderPath: null },
      ],
      images: [
        { blobHash: 'h1', contentType: 'image/png', fileName: 'a.png', slug: '', title: '', folderPath: '' },
      ],
      rootCollectionId: null,
    }

    const result = validateBulkUploadPlan(plan)
    expect(result.valid).toBe(false)
    // Collection: empty title + invalid slug
    // Image: empty title + invalid slug
    expect(result.errors.length).toBeGreaterThanOrEqual(4)
  })
})
