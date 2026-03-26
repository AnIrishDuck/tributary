import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestClientWithStream } from './test-utils'
import { saveImage } from '../src/actions/saveImage'
import { parseImageBlockBody, getImageBySlug, getLibrary, createCollection, indexAll } from 'scribe-data'

describe('saveImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create an image block with correct metadata', async () => {
    const { stream } = await createTestClientWithStream()

    const fileData = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) // PNG header bytes
    const { block } = await saveImage(stream, {
      fileData,
      contentType: 'image/png',
      fileName: 'test-photo.png',
      slug: 'test-photo',
      title: 'Test Photo',
      width: 800,
      height: 600,
    })

    expect(block.block_uuid).toBeDefined()
    expect(block.slug).toBe('test-photo')

    const body = parseImageBlockBody(block)
    expect(body.blobHash).toBeDefined()
    expect(body.contentType).toBe('image/png')
    expect(body.fileName).toBe('test-photo.png')
    expect(body.width).toBe(800)
    expect(body.height).toBe(600)
  })

  it('should resolve the created image by slug', async () => {
    const { stream } = await createTestClientWithStream()

    const fileData = new Uint8Array([255, 216, 255, 224]) // JPEG header bytes
    await saveImage(stream, {
      fileData,
      contentType: 'image/jpeg',
      fileName: 'sunset.jpg',
      slug: 'sunset',
      width: 1920,
      height: 1080,
    })

    const localDb = stream.local()
    // createNote defaults null collection_id to the library root UUID
    const library = await getLibrary(localDb)
    expect(library).toBeDefined()
    const result = await getImageBySlug(localDb, 'sunset', library!.collection_uuid)
    expect(result).not.toBeNull()
    expect(result!.body.contentType).toBe('image/jpeg')
    expect(result!.body.width).toBe(1920)
  })

  it('should create an image in a specific collection', async () => {
    const { stream } = await createTestClientWithStream()

    const localDb = stream.local()
    const library = await getLibrary(localDb)
    expect(library).toBeDefined()

    const col = await createCollection(stream, {
      title: 'Photos',
      parent_collection_uuid: library!.collection_uuid,
      inserter: 'test-user',
    })

    // Re-index after collection creation
    const { indexAll } = await import('scribe-data')
    await indexAll(localDb)

    const fileData = new Uint8Array([137, 80, 78, 71])
    const { block } = await saveImage(stream, {
      fileData,
      contentType: 'image/png',
      fileName: 'landscape.png',
      slug: 'landscape',
      collectionId: col.collection_uuid,
      width: 640,
      height: 480,
    })

    expect(block.collection_id).toBe(col.collection_uuid)

    // Should be findable in that collection
    const result = await getImageBySlug(localDb, 'landscape', col.collection_uuid)
    expect(result).not.toBeNull()

    // Should NOT be findable at root
    const rootResult = await getImageBySlug(localDb, 'landscape', null)
    expect(rootResult).toBeNull()
  })

  it('should return a slug path for navigation', async () => {
    const { stream } = await createTestClientWithStream()

    const fileData = new Uint8Array([0, 1, 2, 3])
    const { slugPath } = await saveImage(stream, {
      fileData,
      contentType: 'image/png',
      fileName: 'icon.png',
      slug: 'icon',
      width: 32,
      height: 32,
    })

    expect(slugPath).toEqual(['icon'])
  })
})
