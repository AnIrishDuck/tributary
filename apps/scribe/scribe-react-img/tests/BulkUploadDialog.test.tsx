import React from 'react'
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BulkUploadDialog from '../src/components/BulkUploadDialog'
import { createTestClientWithStream } from './test-utils'
import * as scribeData from 'scribe-data'
import type { BulkUploadPlan } from 'scribe-data'

// jsdom doesn't have URL.createObjectURL
beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:test-url')
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn()
  }
})

/** Build a minimal plan with images at the root (no sub-collections). */
function makePlan(imageNames: string[], rootCollectionId: string | null = null): BulkUploadPlan {
  return {
    collections: [],
    images: imageNames.map((name) => ({
      blobHash: '',
      contentType: 'image/png',
      fileName: name,
      slug: name.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '-'),
      title: name.replace(/\.[^.]+$/, ''),
      folderPath: '',
    })),
    rootCollectionId,
  }
}

/** Build a plan with images across sub-folders. */
function makePlanWithFolders(rootCollectionId: string | null = null): BulkUploadPlan {
  return {
    collections: [
      { folderPath: 'landscapes', title: 'landscapes', slug: 'landscapes', parentFolderPath: null },
    ],
    images: [
      {
        blobHash: '', contentType: 'image/png', fileName: 'root.png',
        slug: 'root', title: 'root', folderPath: '',
      },
      {
        blobHash: '', contentType: 'image/jpeg', fileName: 'mountain.jpg',
        slug: 'mountain', title: 'mountain', folderPath: 'landscapes',
      },
    ],
    rootCollectionId,
  }
}

/** Create a map of File objects keyed by plan image index. */
function makeFiles(plan: BulkUploadPlan): Map<number, File> {
  const files = new Map<number, File>()
  const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  plan.images.forEach((img, i) => {
    const file = new File([pngBytes], img.fileName, { type: img.contentType })
    // jsdom's File doesn't implement arrayBuffer(); polyfill via FileReader
    if (!file.arrayBuffer) {
      file.arrayBuffer = () =>
        new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as ArrayBuffer)
          reader.onerror = () => reject(reader.error)
          reader.readAsArrayBuffer(file)
        })
    }
    files.set(i, file)
  })
  return files
}

/**
 * Mock globalThis.Image so that getImageDimensions resolves.
 * jsdom's Image can't actually load blob URLs, so we replace it
 * with a fake that fires onload with synthetic dimensions.
 */
function mockImage(width: number, height: number) {
  const OriginalImage = globalThis.Image
  function FakeImage(this: any) {
    const self = this
    self.naturalWidth = width
    self.naturalHeight = height
    self.onload = null as any
    self.onerror = null as any
    // Fire onload asynchronously when src is set
    Object.defineProperty(self, 'src', {
      set(_value: string) {
        setTimeout(() => {
          if (self.onload) self.onload(new Event('load'))
        }, 0)
      },
    })
  }
  globalThis.Image = FakeImage as any
  return () => { globalThis.Image = OriginalImage }
}

describe('BulkUploadDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders confirmation phase with image list and summary', () => {
    const plan = makePlan(['beach.png', 'sunset.png', 'forest.png'])
    const files = makeFiles(plan)

    render(
      <BulkUploadDialog
        plan={plan}
        files={files}
        stream={{} as any}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    // Header
    expect(screen.getByText('Bulk Upload')).toBeInTheDocument()

    // Summary line: 3 images in 1 collection (root only, 0 sub-collections + 1)
    expect(screen.getByText('3 images in 1 collection')).toBeInTheDocument()

    // Each filename is listed
    expect(screen.getByText('beach.png')).toBeInTheDocument()
    expect(screen.getByText('sunset.png')).toBeInTheDocument()
    expect(screen.getByText('forest.png')).toBeInTheDocument()

    // Buttons
    expect(screen.getByText('Upload')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('shows singular "image" for a single image', () => {
    const plan = makePlan(['solo.png'])
    render(
      <BulkUploadDialog
        plan={plan}
        files={makeFiles(plan)}
        stream={{} as any}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByText('1 image in 1 collection')).toBeInTheDocument()
  })

  it('groups images by folder and shows folder headers', () => {
    const plan = makePlanWithFolders()
    render(
      <BulkUploadDialog
        plan={plan}
        files={makeFiles(plan)}
        stream={{} as any}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    // Root images show under "Current collection"
    expect(screen.getByText('Current collection')).toBeInTheDocument()
    expect(screen.getByText('root.png')).toBeInTheDocument()

    // Sub-folder images show under folder name
    expect(screen.getByText('landscapes')).toBeInTheDocument()
    expect(screen.getByText('mountain.jpg')).toBeInTheDocument()

    // Summary: 2 images in 2 collections (1 sub + 1 root)
    expect(screen.getByText('2 images in 2 collections')).toBeInTheDocument()
  })

  it('renders all images in a scrollable list for large plans', () => {
    const names = Array.from({ length: 30 }, (_, i) => `img-${i}.png`)
    const plan = makePlan(names)
    render(
      <BulkUploadDialog
        plan={plan}
        files={makeFiles(plan)}
        stream={{} as any}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    // All images present in the DOM (scrollable)
    expect(screen.getByText('img-0.png')).toBeInTheDocument()
    expect(screen.getByText('img-29.png')).toBeInTheDocument()
    expect(screen.getByText('30 images in 1 collection')).toBeInTheDocument()

    // Upload and Cancel buttons still accessible
    expect(screen.getByText('Upload')).toBeInTheDocument()
    expect(screen.getByText('Cancel')).toBeInTheDocument()
  })

  it('calls onCancel when Cancel button is clicked', async () => {
    const onCancel = vi.fn()
    const plan = makePlan(['test.png'])

    render(
      <BulkUploadDialog
        plan={plan}
        files={makeFiles(plan)}
        stream={{} as any}
        onComplete={vi.fn()}
        onCancel={onCancel}
      />
    )

    await userEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('uploads images and transitions through phases to done', async () => {
    const { stream } = await createTestClientWithStream()
    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    const plan = makePlan(['photo.png'], library!.collection_uuid)
    const files = makeFiles(plan)
    const restoreImage = mockImage(100, 50)

    const onComplete = vi.fn()

    render(
      <BulkUploadDialog
        plan={plan}
        files={files}
        stream={stream}
        onComplete={onComplete}
        onCancel={vi.fn()}
      />
    )

    // Confirmation phase
    expect(screen.getByText('Bulk Upload')).toBeInTheDocument()

    // Click Upload
    await userEvent.click(screen.getByText('Upload'))

    // Should transition to done phase
    await waitFor(() => {
      expect(screen.getByText('Upload Complete')).toBeInTheDocument()
    }, { timeout: 10000 })

    // Done button should be visible
    expect(screen.getByText('Done')).toBeInTheDocument()

    // Click Done calls onComplete
    await userEvent.click(screen.getByText('Done'))
    expect(onComplete).toHaveBeenCalledTimes(1)

    // Verify image block was actually created
    await stream.sync(1000)
    await scribeData.indexAll(localDb)
    const notes = await scribeData.getNotesInCollectionWithSlugs(localDb, null)
    const imageNote = notes.find(n => n.slug === 'photo')
    expect(imageNote).toBeDefined()
    expect(imageNote!.block_type).toBe('scribe/image')

    restoreImage()
  })

  it('creates sub-collections and assigns images to them', async () => {
    const { stream } = await createTestClientWithStream()
    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    const plan = makePlanWithFolders(library!.collection_uuid)
    const files = makeFiles(plan)
    const restoreImage = mockImage(200, 150)

    render(
      <BulkUploadDialog
        plan={plan}
        files={files}
        stream={stream}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await userEvent.click(screen.getByText('Upload'))

    await waitFor(() => {
      expect(screen.getByText('Upload Complete')).toBeInTheDocument()
    }, { timeout: 10000 })

    // Verify: sub-collection "landscapes" was created
    await stream.sync(1000)
    await scribeData.indexAll(localDb)
    const childCollections = await scribeData.getChildCollections(localDb, library!.collection_uuid)
    const landscapes = childCollections.find(c => c.slug === 'landscapes')
    expect(landscapes).toBeDefined()

    // Verify: root image is in root collection
    const rootNotes = await scribeData.getNotesInCollectionWithSlugs(localDb, null)
    const rootImage = rootNotes.find(n => n.slug === 'root')
    expect(rootImage).toBeDefined()

    // Verify: mountain image is in the landscapes collection
    const landscapeNotes = await scribeData.getNotesInCollectionWithSlugs(localDb, landscapes!.collection_uuid)
    const mountainImage = landscapeNotes.find(n => n.slug === 'mountain')
    expect(mountainImage).toBeDefined()

    restoreImage()
  })
})
