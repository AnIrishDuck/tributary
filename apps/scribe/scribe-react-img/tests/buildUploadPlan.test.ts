import { describe, it, expect } from 'vitest'
import { buildUploadPlan } from '../src/utils/buildUploadPlan'
import type { FolderFileEntry } from '../src/utils/readFolderEntries'

function fakeFile(name: string, type: string = 'image/png', lastModified?: number): File {
  return new File([new Uint8Array(8)], name, { type, lastModified })
}

function entry(fileName: string, folderPath: string, type?: string, lastModified?: number): FolderFileEntry {
  const file = fakeFile(fileName, type, lastModified)
  const relativePath = folderPath ? `${folderPath}/${fileName}` : fileName
  return { file, relativePath, folderPath }
}

describe('buildUploadPlan', () => {
  it('flat images with no folders', () => {
    const entries = [
      entry('beach.jpg', ''),
      entry('sunset.png', ''),
    ]

    const plan = buildUploadPlan(entries, 'root-id')

    expect(plan.collections).toEqual([])
    expect(plan.rootCollectionId).toBe('root-id')
    expect(plan.images).toHaveLength(2)
    expect(plan.images[0]).toMatchObject({
      blobHash: '',
      contentType: 'image/png',
      fileName: 'beach.jpg',
      slug: 'beach',
      title: 'beach',
      folderPath: '',
    })
  })

  it('single folder with images', () => {
    const entries = [
      entry('alpha.png', 'vacation'),
      entry('beta.jpg', 'vacation', 'image/jpeg'),
    ]

    const plan = buildUploadPlan(entries, 'root-id')

    expect(plan.collections).toHaveLength(1)
    expect(plan.collections[0]).toEqual({
      folderPath: 'vacation',
      title: 'vacation',
      slug: 'vacation',
      parentFolderPath: null,
    })
    expect(plan.images).toHaveLength(2)
    expect(plan.images[0].folderPath).toBe('vacation')
    expect(plan.images[1].contentType).toBe('image/jpeg')
  })

  it('nested folders are sorted parents-first', () => {
    const entries = [
      entry('deep.png', 'a/b/c'),
      entry('mid.png', 'a/b'),
      entry('top.png', 'a'),
    ]

    const plan = buildUploadPlan(entries, null)

    expect(plan.collections.map((c) => c.folderPath)).toEqual([
      'a',
      'a/b',
      'a/b/c',
    ])
  })

  it('sets parentFolderPath correctly for nested collections', () => {
    const entries = [
      entry('img.png', 'photos/vacation/beach'),
    ]

    const plan = buildUploadPlan(entries, null)

    const byPath = Object.fromEntries(
      plan.collections.map((c) => [c.folderPath, c]),
    )

    expect(byPath['photos'].parentFolderPath).toBeNull()
    expect(byPath['photos/vacation'].parentFolderPath).toBe('photos')
    expect(byPath['photos/vacation/beach'].parentFolderPath).toBe('photos/vacation')
  })

  it('derives collection title from last path segment', () => {
    const entries = [
      entry('img.png', 'My Photos/Summer Trip'),
    ]

    const plan = buildUploadPlan(entries, null)

    const trip = plan.collections.find((c) => c.folderPath === 'My Photos/Summer Trip')
    expect(trip!.title).toBe('Summer Trip')
    expect(trip!.slug).toBe('summer-trip')
  })

  it('derives image slug and title from filename', () => {
    const entries = [
      entry('My Vacation Photo.jpeg', ''),
    ]

    const plan = buildUploadPlan(entries, null)

    expect(plan.images[0].slug).toBe('my-vacation-photo')
    expect(plan.images[0].title).toBe('My Vacation Photo')
  })

  it('deduplicates folder paths from multiple images', () => {
    const entries = [
      entry('a.png', 'folder'),
      entry('b.png', 'folder'),
      entry('c.png', 'folder'),
    ]

    const plan = buildUploadPlan(entries, null)

    expect(plan.collections).toHaveLength(1)
    expect(plan.images).toHaveLength(3)
  })

  it('null rootCollectionId is preserved', () => {
    const plan = buildUploadPlan([], null)
    expect(plan.rootCollectionId).toBeNull()
  })

  it('mixed root and folder images', () => {
    const entries = [
      entry('root.png', ''),
      entry('nested.png', 'sub'),
    ]

    const plan = buildUploadPlan(entries, 'root-id')

    expect(plan.collections).toHaveLength(1)
    expect(plan.images).toHaveLength(2)
    expect(plan.images[0].folderPath).toBe('')
    expect(plan.images[1].folderPath).toBe('sub')
  })

  it('sorts images by file mtime oldest first', () => {
    const entries = [
      entry('newest.png', '', 'image/png', 3000),
      entry('oldest.png', '', 'image/png', 1000),
      entry('middle.png', '', 'image/png', 2000),
    ]

    const plan = buildUploadPlan(entries, null)

    expect(plan.images.map((img) => img.fileName)).toEqual([
      'oldest.png',
      'middle.png',
      'newest.png',
    ])
  })

  it('sorts images by mtime across different folders', () => {
    const entries = [
      entry('c.png', 'folder-b', 'image/png', 3000),
      entry('a.png', '', 'image/png', 1000),
      entry('b.png', 'folder-a', 'image/png', 2000),
    ]

    const plan = buildUploadPlan(entries, null)

    expect(plan.images.map((img) => img.fileName)).toEqual([
      'a.png',
      'b.png',
      'c.png',
    ])
  })

  it('creates intermediate folders that have no direct images', () => {
    const entries = [
      entry('deep.png', 'a/b/c'),
    ]

    const plan = buildUploadPlan(entries, null)

    // All intermediate folders must be created so ensureBulkCollections
    // can resolve parent UUIDs
    expect(plan.collections.map((c) => c.folderPath)).toEqual([
      'a',
      'a/b',
      'a/b/c',
    ])
    expect(plan.collections[0].parentFolderPath).toBeNull()
    expect(plan.collections[1].parentFolderPath).toBe('a')
    expect(plan.collections[2].parentFolderPath).toBe('a/b')
  })
})
