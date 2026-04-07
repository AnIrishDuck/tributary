import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { up } from '../src/migrations.js'
import {
  createImageBlock,
  createImageBlocks,
  updateImageBlock,
  parseImageBlockBody,
  getImageBySlug,
} from '../src/image.js'
import {
  indexSlugs,
  indexAll,
  rebuildSlugCollisions,
  getCollidingSlugs,
  getNoteSlugByUuid,
  getAllNotesWithTitles,
  getNotesInCollectionWithSlugs,
} from '../src/indexing.js'
import { resolveSlugPath } from '../src/slug.js'
import { createNote } from '../src/note.js'
import { createCollection } from '../src/collection.js'
import { createTestDB } from './test-utils.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'

describe('scribe-data image blocks', () => {
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
    if (cleanup) await cleanup()
  })

  test('create image block and retrieve by UUID', async () => {
    const image = await createImageBlock(syncedDb, {
      blobHash: 'abc123',
      contentType: 'image/png',
      title: 'My Photo Title',
      altText: 'A photo',
      width: 800,
      height: 600,
      fileName: 'photo.png',
      slug: 'my-photo',
      inserter: 'test-user',
    })

    expect(image.block_uuid).toBeDefined()
    expect(image.block_type).toBe('scribe/image')
    expect(image.slug).toBe('my-photo')

    const body = parseImageBlockBody(image)
    expect(body.blobHash).toBe('abc123')
    expect(body.contentType).toBe('image/png')
    expect(body.title).toBe('My Photo Title')
    expect(body.altText).toBe('A photo')
    expect(body.width).toBe(800)
    expect(body.height).toBe(600)
    expect(body.fileName).toBe('photo.png')
  })

  test('parse image block body correctly', async () => {
    const image = await createImageBlock(syncedDb, {
      blobHash: 'hash123',
      contentType: 'image/jpeg',
      slug: 'test-img',
      inserter: 'test-user',
    })

    const body = parseImageBlockBody(image)
    expect(body.blobHash).toBe('hash123')
    expect(body.contentType).toBe('image/jpeg')
    expect(body.altText).toBeUndefined()
    expect(body.width).toBeUndefined()
    expect(body.height).toBeUndefined()
  })

  test('parseImageBlockBody throws on invalid body', () => {
    const fakeNote = {
      block_uuid: 'x', block_type: 'scribe/image', version_uuid: 'v',
      prior_version_uuid: null, insert_datetime: '', inserter: '',
      body: '{}', collection_id: null, slug: 'x',
    }
    expect(() => parseImageBlockBody(fakeNote)).toThrow('missing blobHash or contentType')
  })

  test('resolve image by slug', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user',
    })

    await createImageBlock(syncedDb, {
      blobHash: 'hash456',
      contentType: 'image/png',
      altText: 'Sunset',
      slug: 'sunset',
      inserter: 'test-user',
      collectionId: root.collection_uuid,
    })

    await indexSlugs(localDb)

    const found = await getImageBySlug(localDb, 'sunset', root.collection_uuid)
    expect(found).not.toBeNull()
    expect(found!.note.slug).toBe('sunset')
    expect(found!.body.blobHash).toBe('hash456')
    expect(found!.body.contentType).toBe('image/png')
  })

  test('image blocks indexed correctly (slug derived, no FTS crash)', async () => {
    await createImageBlock(syncedDb, {
      blobHash: 'blobhash',
      contentType: 'image/webp',
      slug: 'landscape',
      inserter: 'test-user',
    })

    // indexAll includes FTS indexing — should not crash on image JSON body
    const result = await indexAll(localDb)
    expect(result.indexedCount).toBe(1)

    const slug = await getNoteSlugByUuid(localDb, (await localDb.query(
      `SELECT block_uuid FROM block WHERE block_type = 'scribe/image'`, []
    )).rows![0].block_uuid)
    expect(slug).toBeDefined()
    expect(slug!.slug).toBe('landscape')
  })

  test('title field is stored in body and used as canonical title', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user',
    })

    const image = await createImageBlock(syncedDb, {
      blobHash: 'hashTitle',
      contentType: 'image/png',
      title: 'Sunset at the Beach',
      altText: 'A sunset photo',
      fileName: 'sunset.png',
      slug: 'sunset-title',
      inserter: 'test-user',
      collectionId: root.collection_uuid,
    })

    // Title should be stored in body JSON
    const body = parseImageBlockBody(image)
    expect(body.title).toBe('Sunset at the Beach')

    await indexSlugs(localDb)

    // Title should take priority over altText and fileName in slug lookups
    const slugResult = await getNoteSlugByUuid(localDb, image.block_uuid)
    expect(slugResult).not.toBeNull()
    expect(slugResult!.title).toBe('Sunset at the Beach')

    // Title should take priority in getAllNotesWithTitles
    const all = await getAllNotesWithTitles(localDb)
    const found = all.find(n => n.slug === 'sunset-title')
    expect(found).toBeDefined()
    expect(found!.title).toBe('Sunset at the Beach')

    // Title should take priority in getImageBySlug
    const bySlug = await getImageBySlug(localDb, 'sunset-title', root.collection_uuid)
    expect(bySlug).not.toBeNull()
    expect(bySlug!.note.title).toBe('Sunset at the Beach')
  })

  test('title fallback chain: altText when no title, fileName when no altText', async () => {
    // No title, has altText -> use altText
    const img1 = await createImageBlock(syncedDb, {
      blobHash: 'hashFallback1',
      contentType: 'image/png',
      altText: 'Alt text only',
      fileName: 'file.png',
      slug: 'fallback-alt',
      inserter: 'test-user',
    })
    const body1 = parseImageBlockBody(img1)
    expect(body1.title).toBeUndefined()

    await indexSlugs(localDb)
    const slug1 = await getNoteSlugByUuid(localDb, img1.block_uuid)
    expect(slug1!.title).toBe('Alt text only')

    // No title, no altText, has fileName -> use fileName
    const img2 = await createImageBlock(syncedDb, {
      blobHash: 'hashFallback2',
      contentType: 'image/jpeg',
      fileName: 'vacation.jpg',
      slug: 'fallback-file',
      inserter: 'test-user',
    })

    await indexSlugs(localDb)
    const slug2 = await getNoteSlugByUuid(localDb, img2.block_uuid)
    expect(slug2!.title).toBe('vacation.jpg')
  })

  test('version an image block (replace with new blob hash)', async () => {
    const image = await createImageBlock(syncedDb, {
      blobHash: 'original-hash',
      contentType: 'image/png',
      width: 100,
      height: 100,
      slug: 'my-image',
      inserter: 'test-user',
    })

    const updated = await updateImageBlock(syncedDb, image.block_uuid, {
      blobHash: 'new-hash',
      width: 200,
      height: 200,
      inserter: 'test-user',
    })

    expect(updated.block_uuid).toBe(image.block_uuid)
    expect(updated.version_uuid).not.toBe(image.version_uuid)

    const body = parseImageBlockBody(updated)
    expect(body.blobHash).toBe('new-hash')
    expect(body.contentType).toBe('image/png') // carried forward
    expect(body.width).toBe(200)
    expect(body.height).toBe(200)
  })

  test('update image block title', async () => {
    const image = await createImageBlock(syncedDb, {
      blobHash: 'hashUpdateTitle',
      contentType: 'image/png',
      title: 'Original Title',
      slug: 'update-title-img',
      inserter: 'test-user',
    })

    const body = parseImageBlockBody(image)
    expect(body.title).toBe('Original Title')

    const updated = await updateImageBlock(syncedDb, image.block_uuid, {
      title: 'Updated Title',
      inserter: 'test-user',
    })

    const updatedBody = parseImageBlockBody(updated)
    expect(updatedBody.title).toBe('Updated Title')
    expect(updatedBody.blobHash).toBe('hashUpdateTitle') // carried forward
  })

  test('slug collision between a note and an image with the same slug', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user',
    })

    // Create a note with slug "sunset"
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Sunset\n\nA beautiful sunset.',
      inserter: 'test-user',
      collection_id: root.collection_uuid,
      slug: 'sunset',
    })

    // Create an image with slug "sunset"
    await createImageBlock(syncedDb, {
      blobHash: 'hash789',
      contentType: 'image/jpeg',
      slug: 'sunset',
      inserter: 'test-user',
      collectionId: root.collection_uuid,
    })

    await indexSlugs(localDb)
    await rebuildSlugCollisions(localDb)

    const collisions = await getCollidingSlugs(localDb, root.collection_uuid)
    expect(collisions.has('sunset')).toBe(true)
  })

  test('resolveSlugPath returns type image for an image block', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user',
    })

    await createImageBlock(syncedDb, {
      blobHash: 'hashABC',
      contentType: 'image/png',
      slug: 'hero-banner',
      inserter: 'test-user',
      collectionId: root.collection_uuid,
    })

    await indexSlugs(localDb)

    const result = await resolveSlugPath(localDb, ['hero-banner'], root.collection_uuid)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('image')
    expect(result!.entity.slug).toBe('hero-banner')
  })

  test('resolveSlugPath returns collision when a note and image share a slug', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user',
    })

    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Banner\n\nSome text.',
      inserter: 'test-user',
      collection_id: root.collection_uuid,
      slug: 'banner',
    })

    await createImageBlock(syncedDb, {
      blobHash: 'hashXYZ',
      contentType: 'image/jpeg',
      slug: 'banner',
      inserter: 'test-user',
      collectionId: root.collection_uuid,
    })

    await indexSlugs(localDb)

    const result = await resolveSlugPath(localDb, ['banner'], root.collection_uuid)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('collision')
    expect(result!.collisions).toBeDefined()
    expect(result!.collisions!.notes).toHaveLength(2) // both note and image are blocks
  })

  test('getNoteSlugByUuid returns block_type for image blocks', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user',
    })

    const image = await createImageBlock(syncedDb, {
      blobHash: 'hashSlugByUuid',
      contentType: 'image/png',
      altText: 'Hero image',
      fileName: 'hero.png',
      slug: 'hero',
      inserter: 'test-user',
      collectionId: root.collection_uuid,
    })

    await indexSlugs(localDb)

    const result = await getNoteSlugByUuid(localDb, image.block_uuid)
    expect(result).not.toBeNull()
    expect(result!.block_type).toBe('scribe/image')
    expect(result!.slug).toBe('hero')
    // Title should come from altText or fileName, not markdown extraction
    expect(result!.title).toBe('Hero image')
  })

  test('getNoteSlugByUuid uses fileName when altText is absent', async () => {
    const image = await createImageBlock(syncedDb, {
      blobHash: 'hashFileName',
      contentType: 'image/jpeg',
      fileName: 'vacation.jpg',
      slug: 'vacation',
      inserter: 'test-user',
    })

    await indexSlugs(localDb)

    const result = await getNoteSlugByUuid(localDb, image.block_uuid)
    expect(result).not.toBeNull()
    expect(result!.title).toBe('vacation.jpg')
  })

  test('getAllNotesWithTitles includes image blocks with block_type', async () => {
    // Create a markdown note
    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# My Note\n\nSome text.',
      inserter: 'test-user',
      slug: 'my-note',
    })

    // Create an image block
    await createImageBlock(syncedDb, {
      blobHash: 'hashAll',
      contentType: 'image/png',
      fileName: 'photo.png',
      slug: 'photo',
      inserter: 'test-user',
    })

    await indexSlugs(localDb)

    const all = await getAllNotesWithTitles(localDb)
    expect(all.length).toBe(2)

    const note = all.find(n => n.slug === 'my-note')
    const image = all.find(n => n.slug === 'photo')

    expect(note).toBeDefined()
    expect(note!.block_type).toBe('scribe/markdown')
    expect(note!.title).toBe('My Note')

    expect(image).toBeDefined()
    expect(image!.block_type).toBe('scribe/image')
    expect(image!.title).toBe('photo.png')
  })

  test('getNotesInCollectionWithSlugs includes block_type for images', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user',
    })

    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Recipe\n\nA recipe.',
      inserter: 'test-user',
      collection_id: root.collection_uuid,
      slug: 'recipe',
    })

    await createImageBlock(syncedDb, {
      blobHash: 'hashCol',
      contentType: 'image/jpeg',
      altText: 'Food photo',
      slug: 'food-photo',
      inserter: 'test-user',
      collectionId: root.collection_uuid,
    })

    await indexSlugs(localDb)

    const items = await getNotesInCollectionWithSlugs(localDb, root.collection_uuid)
    expect(items.length).toBe(2)

    const note = items.find(n => n.slug === 'recipe')
    const image = items.find(n => n.slug === 'food-photo')

    expect(note).toBeDefined()
    expect(note!.block_type).toBe('scribe/markdown')

    expect(image).toBeDefined()
    expect(image!.block_type).toBe('scribe/image')
    expect(image!.title).toBe('Food photo')
  })

  test('collision data includes both notes and images with block_type', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user',
    })

    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Banner\n\nText content.',
      inserter: 'test-user',
      collection_id: root.collection_uuid,
      slug: 'banner',
    })

    await createImageBlock(syncedDb, {
      blobHash: 'hashCollision',
      contentType: 'image/png',
      slug: 'banner',
      inserter: 'test-user',
      collectionId: root.collection_uuid,
    })

    await indexSlugs(localDb)

    const result = await resolveSlugPath(localDb, ['banner'], root.collection_uuid)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('collision')

    const notes = result!.collisions!.notes
    expect(notes).toHaveLength(2)

    const markdownBlock = notes.find((n: any) => n.block_type === 'scribe/markdown')
    const imageBlock = notes.find((n: any) => n.block_type === 'scribe/image')
    expect(markdownBlock).toBeDefined()
    expect(imageBlock).toBeDefined()
  })

  test('createImageBlock with thumbBlobHash round-trips through parseImageBlockBody', async () => {
    const image = await createImageBlock(syncedDb, {
      blobHash: 'hashWithThumb',
      contentType: 'image/png',
      thumbBlobHash: 'thumb-hash-123',
      slug: 'with-thumb',
      inserter: 'test-user',
    })

    const body = parseImageBlockBody(image)
    expect(body.thumbBlobHash).toBe('thumb-hash-123')
    expect(body.blobHash).toBe('hashWithThumb')
  })

  test('createImageBlock without thumbBlobHash still works (backward compat)', async () => {
    const image = await createImageBlock(syncedDb, {
      blobHash: 'hashNoThumb',
      contentType: 'image/jpeg',
      slug: 'no-thumb',
      inserter: 'test-user',
    })

    const body = parseImageBlockBody(image)
    expect(body.thumbBlobHash).toBeUndefined()
    expect(body.blobHash).toBe('hashNoThumb')
  })

  test('createImageBlocks (batch) includes thumbBlobHash in each block body', async () => {
    const images = await createImageBlocks(syncedDb, [
      {
        blobHash: 'batch-hash-1',
        contentType: 'image/png',
        thumbBlobHash: 'batch-thumb-1',
        slug: 'batch-1',
        inserter: 'test-user',
      },
      {
        blobHash: 'batch-hash-2',
        contentType: 'image/jpeg',
        thumbBlobHash: 'batch-thumb-2',
        slug: 'batch-2',
        inserter: 'test-user',
      },
    ])

    expect(images).toHaveLength(2)
    const body0 = parseImageBlockBody(images[0])
    const body1 = parseImageBlockBody(images[1])
    expect(body0.thumbBlobHash).toBe('batch-thumb-1')
    expect(body1.thumbBlobHash).toBe('batch-thumb-2')
  })

  test('updateImageBlock preserves thumbBlobHash when not in updates', async () => {
    const image = await createImageBlock(syncedDb, {
      blobHash: 'hashPreserveThumb',
      contentType: 'image/png',
      thumbBlobHash: 'existing-thumb',
      slug: 'preserve-thumb',
      inserter: 'test-user',
    })

    const updated = await updateImageBlock(syncedDb, image.block_uuid, {
      title: 'New Title',
      inserter: 'test-user',
    })

    const body = parseImageBlockBody(updated)
    expect(body.thumbBlobHash).toBe('existing-thumb')
    expect(body.title).toBe('New Title')
  })

  test('updateImageBlock can set thumbBlobHash', async () => {
    const image = await createImageBlock(syncedDb, {
      blobHash: 'hashSetThumb',
      contentType: 'image/png',
      slug: 'set-thumb',
      inserter: 'test-user',
    })

    const body0 = parseImageBlockBody(image)
    expect(body0.thumbBlobHash).toBeUndefined()

    const updated = await updateImageBlock(syncedDb, image.block_uuid, {
      thumbBlobHash: 'new-thumb-hash',
      inserter: 'test-user',
    })

    const body = parseImageBlockBody(updated)
    expect(body.thumbBlobHash).toBe('new-thumb-hash')
    expect(body.blobHash).toBe('hashSetThumb')
  })

  test('resolveSlugPath returns type note for a markdown block', async () => {
    const root = await createCollection(syncedDb, {
      title: 'My Library',
      inserter: 'test-user',
    })

    await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# My Note\n\nContent.',
      inserter: 'test-user',
      collection_id: root.collection_uuid,
      slug: 'my-note',
    })

    await indexSlugs(localDb)

    const result = await resolveSlugPath(localDb, ['my-note'], root.collection_uuid)
    expect(result).not.toBeNull()
    expect(result!.type).toBe('note')
  })
})
