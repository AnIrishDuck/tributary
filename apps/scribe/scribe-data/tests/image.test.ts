import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { up } from '../src/migrations.js'
import {
  createImageBlock,
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
