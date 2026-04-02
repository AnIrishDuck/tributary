import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBlob, clearBlobCache } from '../src/hooks/useBlob'
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

describe('useBlob', () => {
  beforeEach(() => {
    clearBlobCache()
    blobCounter = 0
  })

  it('returns null URL immediately for null hash', () => {
    const { result } = renderHook(() => useBlob(null, null))
    expect(result.current.objectUrl).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('downloads blob and returns object URL', async () => {
    const { stream } = await createTestClientWithStream()
    const data = new Uint8Array([1, 2, 3, 4, 5])
    const blobHash = await stream.blob().upload(data)

    const { result } = renderHook(() => useBlob(blobHash, stream))

    // Initially loading
    expect(result.current.loading).toBe(true)

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.objectUrl).toBeTruthy()
    expect(result.current.objectUrl).toMatch(/^blob:/)
    expect(result.current.error).toBeNull()
  })

  it('returns cached URL on second call with same hash (no duplicate download)', async () => {
    const { stream } = await createTestClientWithStream()
    const data = new Uint8Array([10, 20, 30])
    const blobHash = await stream.blob().upload(data)

    // First render: download
    const { result: result1, unmount } = renderHook(() => useBlob(blobHash, stream))
    await waitFor(() => {
      expect(result1.current.loading).toBe(false)
    })
    const firstUrl = result1.current.objectUrl
    expect(firstUrl).toBeTruthy()
    unmount()

    // Second render: should get cached URL immediately
    const { result: result2 } = renderHook(() => useBlob(blobHash, stream))
    // Cache hit should set URL synchronously via initial state
    expect(result2.current.objectUrl).toBe(firstUrl)
    expect(result2.current.loading).toBe(false)
  })

  it('sets error state when download fails', async () => {
    const { stream } = await createTestClientWithStream()
    const fakeBlobHash = 'nonexistent-blob-hash'

    const { result } = renderHook(() => useBlob(fakeBlobHash, stream))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBeInstanceOf(Error)
    expect(result.current.objectUrl).toBeNull()
  })

  it('resets to null when blobHash changes to null', async () => {
    const { stream } = await createTestClientWithStream()
    const data = new Uint8Array([1, 2, 3])
    const blobHash = await stream.blob().upload(data)

    let hash: string | null = blobHash
    const { result, rerender } = renderHook(() => useBlob(hash, stream))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.objectUrl).toBeTruthy()

    // Change to null
    hash = null
    rerender()

    expect(result.current.objectUrl).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})
