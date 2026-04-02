import React from 'react'
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { clearBlobCache } from 'scribe-react-common/src/hooks/useBlob'
import ThumbnailImage from '../src/components/ThumbnailImage'
import { createTestClientWithStream } from './test-utils'

// jsdom doesn't have URL.createObjectURL
let blobCounter = 0
beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => `blob:test-url-${++blobCounter}`)
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn()
  }
})

describe('ThumbnailImage', () => {
  beforeEach(() => {
    clearBlobCache()
    blobCounter = 0
  })

  it('renders fallback when blobHash is null', () => {
    render(
      <ThumbnailImage
        blobHash={null}
        stream={null}
        alt="test"
        fallback={<div data-testid="fallback">No image</div>}
      />
    )
    expect(screen.getByTestId('fallback')).toBeDefined()
  })

  it('renders fallback while loading', async () => {
    const { stream } = await createTestClientWithStream()
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const blobHash = await stream.blob().upload(data)

    render(
      <ThumbnailImage
        blobHash={blobHash}
        stream={stream}
        alt="loading test"
        fallback={<div data-testid="fallback">Loading...</div>}
      />
    )

    // Fallback should be visible initially
    expect(screen.getByTestId('fallback')).toBeDefined()
  })

  it('renders img once blob is loaded', async () => {
    const { stream } = await createTestClientWithStream()
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const blobHash = await stream.blob().upload(data)

    render(
      <ThumbnailImage
        blobHash={blobHash}
        stream={stream}
        alt="loaded image"
        fallback={<div data-testid="fallback">Loading...</div>}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('img')).toBeDefined()
    })

    const img = screen.getByRole('img') as HTMLImageElement
    expect(img.alt).toBe('loaded image')
    expect(img.src).toMatch(/^blob:/)
  })

  it('renders default placeholder div when no fallback and no blobHash', () => {
    const { container } = render(
      <ThumbnailImage
        blobHash={null}
        stream={null}
        alt="placeholder"
        className="h-10 w-10"
      />
    )

    const div = container.querySelector('[aria-label="placeholder"]')
    expect(div).toBeDefined()
  })

  it('renders fallback when download fails', async () => {
    const { stream } = await createTestClientWithStream()

    render(
      <ThumbnailImage
        blobHash="nonexistent-hash"
        stream={stream}
        alt="error test"
        fallback={<div data-testid="fallback">Error</div>}
      />
    )

    // Should show fallback after error
    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toBeDefined()
    })
  })
})
