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
    images: imageNames.map((name, i) => ({
      blobHash: '',
      contentType: 'image/png',
      fileName: name,
      slug: name.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g, '-'),
      title: name.replace(/\.[^.]+$/, ''),
      folderPath: '',
      lastModified: (i + 1) * 1000,
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
        slug: 'root', title: 'root', folderPath: '', lastModified: 1000,
      },
      {
        blobHash: '', contentType: 'image/jpeg', fileName: 'mountain.jpg',
        slug: 'mountain', title: 'mountain', folderPath: 'landscapes', lastModified: 2000,
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

  it('shows sort menu and reorders images when sort changes', async () => {
    const plan: BulkUploadPlan = {
      collections: [],
      images: [
        { blobHash: '', contentType: 'image/png', fileName: 'charlie.png', slug: 'charlie', title: 'charlie', folderPath: '', lastModified: 1000 },
        { blobHash: '', contentType: 'image/png', fileName: 'alpha.png', slug: 'alpha', title: 'alpha', folderPath: '', lastModified: 3000 },
        { blobHash: '', contentType: 'image/png', fileName: 'bravo.png', slug: 'bravo', title: 'bravo', folderPath: '', lastModified: 2000 },
      ],
      rootCollectionId: null,
    }
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

    // Sort button is present
    const sortButton = screen.getByRole('button', { name: 'Sort' })
    expect(sortButton).toBeInTheDocument()

    // Default sort is mtime asc — charlie (1000), bravo (2000), alpha (3000)
    let items = screen.getAllByText(/\.png$/)
    expect(items.map(el => el.textContent)).toEqual(['charlie.png', 'bravo.png', 'alpha.png'])

    // Switch to alphabetical sort
    await userEvent.click(sortButton)
    await userEvent.click(screen.getByText('Alphabetical'))

    items = screen.getAllByText(/\.png$/)
    expect(items.map(el => el.textContent)).toEqual(['alpha.png', 'bravo.png', 'charlie.png'])
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

  it('shows edit button on hover and opens inline editor for image title/slug', async () => {
    const plan = makePlan(['beach.png'])
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

    // Click the edit button for the image
    const editButton = screen.getByLabelText('Edit beach.png')
    await userEvent.click(editButton)

    // Title and slug inputs should now be visible
    const titleInput = screen.getByTestId('image-title-0')
    const slugInput = screen.getByTestId('image-slug-0')
    expect(titleInput).toBeInTheDocument()
    expect(slugInput).toBeInTheDocument()
    expect((titleInput as HTMLInputElement).value).toBe('beach')
    expect((slugInput as HTMLInputElement).value).toBe('beach')
  })

  it('allows editing image title and auto-derives slug', async () => {
    const plan = makePlan(['beach.png'])
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

    await userEvent.click(screen.getByLabelText('Edit beach.png'))

    const titleInput = screen.getByTestId('image-title-0')
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, 'My Great Photo')

    // Slug should auto-derive from title
    const slugInput = screen.getByTestId('image-slug-0')
    expect((slugInput as HTMLInputElement).value).toBe('my-great-photo')
  })

  it('allows editing image slug independently', async () => {
    const plan = makePlan(['beach.png'])
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

    await userEvent.click(screen.getByLabelText('Edit beach.png'))

    const slugInput = screen.getByTestId('image-slug-0')
    await userEvent.clear(slugInput)
    await userEvent.type(slugInput, 'custom-slug')

    expect((slugInput as HTMLInputElement).value).toBe('custom-slug')

    // Title should remain unchanged
    const titleInput = screen.getByTestId('image-title-0')
    expect((titleInput as HTMLInputElement).value).toBe('beach')
  })

  it('disables Upload button when plan has invalid slug format', async () => {
    const plan: BulkUploadPlan = {
      collections: [],
      images: [
        { blobHash: '', contentType: 'image/png', fileName: 'a.png', slug: 'INVALID', title: 'A', folderPath: '', lastModified: 1000 },
      ],
      rootCollectionId: null,
    }
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

    const uploadButton = screen.getByText('Upload')
    expect(uploadButton).toBeDisabled()
  })

  it('shows validation error banner when plan has format errors', async () => {
    const plan: BulkUploadPlan = {
      collections: [],
      images: [
        { blobHash: '', contentType: 'image/png', fileName: 'a.png', slug: 'INVALID', title: 'A', folderPath: '', lastModified: 1000 },
      ],
      rootCollectionId: null,
    }
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

    expect(screen.getByText(/validation error/i)).toBeInTheDocument()
  })

  it('enables Upload button after fixing invalid slug format', async () => {
    const plan: BulkUploadPlan = {
      collections: [],
      images: [
        { blobHash: '', contentType: 'image/png', fileName: 'a.png', slug: 'INVALID', title: 'A', folderPath: '', lastModified: 1000 },
      ],
      rootCollectionId: null,
    }
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

    // Upload should be disabled initially
    expect(screen.getByText('Upload')).toBeDisabled()

    // Edit the image's slug to fix the format
    await userEvent.click(screen.getByLabelText('Edit a.png'))
    const slugInput = screen.getByTestId('image-slug-0')
    await userEvent.clear(slugInput)
    await userEvent.type(slugInput, 'valid-slug')

    // Upload should now be enabled
    expect(screen.getByText('Upload')).not.toBeDisabled()
  })

  it('shows inline slug error messages in edit mode', async () => {
    const plan: BulkUploadPlan = {
      collections: [],
      images: [
        { blobHash: '', contentType: 'image/png', fileName: 'a.png', slug: 'BAD SLUG', title: 'A', folderPath: '', lastModified: 1000 },
      ],
      rootCollectionId: null,
    }
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

    await userEvent.click(screen.getByLabelText('Edit a.png'))
    expect(screen.getByText('Invalid slug format')).toBeInTheDocument()
  })

  it('allows editing collection title and slug', async () => {
    const plan = makePlanWithFolders()
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

    // Click edit on the collection header
    const editColButton = screen.getByLabelText('Edit collection landscapes')
    await userEvent.click(editColButton)

    // Collection title and slug inputs should appear
    const titleInput = screen.getByTestId('collection-title-0')
    const slugInput = screen.getByTestId('collection-slug-0')
    expect(titleInput).toBeInTheDocument()
    expect(slugInput).toBeInTheDocument()

    // Edit the title, slug should auto-derive
    await userEvent.clear(titleInput)
    await userEvent.type(titleInput, 'Nature Photos')

    expect((slugInput as HTMLInputElement).value).toBe('nature-photos')
  })

  it('uploads with edited slug values', async () => {
    const { stream } = await createTestClientWithStream()
    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    const plan = makePlan(['photo.png'], library!.collection_uuid)
    const files = makeFiles(plan)
    const restoreImage = mockImage(100, 50)

    render(
      <BulkUploadDialog
        plan={plan}
        files={files}
        stream={stream}
        onComplete={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    // Edit the slug before uploading
    await userEvent.click(screen.getByLabelText('Edit photo.png'))
    const slugInput = screen.getByTestId('image-slug-0')
    await userEvent.clear(slugInput)
    await userEvent.type(slugInput, 'custom-name')

    // Close editor and upload
    await userEvent.click(screen.getByText('Done editing'))
    await userEvent.click(screen.getByText('Upload'))

    await waitFor(() => {
      expect(screen.getByText('Upload Complete')).toBeInTheDocument()
    }, { timeout: 10000 })

    // Verify the image was created with the custom slug
    await stream.sync(1000)
    await scribeData.indexAll(localDb)
    const notes = await scribeData.getNotesInCollectionWithSlugs(localDb, null)
    const imageNote = notes.find(n => n.slug === 'custom-name')
    expect(imageNote).toBeDefined()
    expect(imageNote!.block_type).toBe('scribe/image')

    restoreImage()
  })
})
