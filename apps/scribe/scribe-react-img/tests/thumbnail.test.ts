import { describe, it, expect } from 'vitest'
import { thumbnailDimensions } from '../src/utils/thumbnail'
import type { ImageBlockBody } from 'scribe-data'

describe('thumbnailDimensions', () => {
  it('scales landscape image so width equals maxEdge', () => {
    const result = thumbnailDimensions(1000, 500, 200)
    expect(result).toEqual({ width: 200, height: 100 })
  })

  it('scales portrait image so height equals maxEdge', () => {
    const result = thumbnailDimensions(500, 1000, 200)
    expect(result).toEqual({ width: 100, height: 200 })
  })

  it('scales square image to maxEdge x maxEdge', () => {
    const result = thumbnailDimensions(800, 800, 200)
    expect(result).toEqual({ width: 200, height: 200 })
  })

  it('returns original dimensions when already within maxEdge', () => {
    const result = thumbnailDimensions(150, 100, 200)
    expect(result).toEqual({ width: 150, height: 100 })
  })

  it('returns original dimensions when exactly at maxEdge', () => {
    const result = thumbnailDimensions(200, 200, 200)
    expect(result).toEqual({ width: 200, height: 200 })
  })

  it('preserves aspect ratio for non-trivial dimensions', () => {
    const original = { width: 1920, height: 1080 }
    const thumb = thumbnailDimensions(original.width, original.height, 200)
    const originalRatio = original.width / original.height
    const thumbRatio = thumb.width / thumb.height
    expect(Math.abs(originalRatio - thumbRatio)).toBeLessThan(0.02)
  })

  it('handles 1x1 image', () => {
    const result = thumbnailDimensions(1, 1, 200)
    expect(result).toEqual({ width: 1, height: 1 })
  })

  it('scales when only one dimension exceeds maxEdge', () => {
    const result = thumbnailDimensions(400, 100, 200)
    expect(result).toEqual({ width: 200, height: 50 })
  })
})

describe('ImageBlockBody type', () => {
  it('accepts thumbBlobHash field', () => {
    const body: ImageBlockBody = {
      blobHash: 'abc',
      contentType: 'image/jpeg',
      thumbBlobHash: 'thumb123',
    }
    expect(body.thumbBlobHash).toBe('thumb123')
  })

  it('thumbBlobHash is optional', () => {
    const body: ImageBlockBody = {
      blobHash: 'abc',
      contentType: 'image/jpeg',
    }
    expect(body.thumbBlobHash).toBeUndefined()
  })
})
