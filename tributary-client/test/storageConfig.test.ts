import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchStorageServerUrl } from '../src/storageConfig'

describe('fetchStorageServerUrl', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns custom server URL when configured', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ server_url: 'https://custom.example.com/stream' }),
    })

    const result = await fetchStorageServerUrl('https://central.supabase.co', 'test-token')
    expect(result).toBe('https://custom.example.com/stream')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://central.supabase.co/functions/v1/storage',
      { headers: { Authorization: 'Bearer test-token' } },
    )
  })

  it('returns null when no custom server is configured', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ server_url: null }),
    })

    const result = await fetchStorageServerUrl('https://central.supabase.co', 'test-token')
    expect(result).toBeNull()
  })

  it('returns null on HTTP error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })

    const result = await fetchStorageServerUrl('https://central.supabase.co', 'test-token')
    expect(result).toBeNull()
  })

  it('returns null on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const result = await fetchStorageServerUrl('https://central.supabase.co', 'test-token')
    expect(result).toBeNull()
  })

  it('strips trailing slash from base URL', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ server_url: null }),
    })

    await fetchStorageServerUrl('https://central.supabase.co/', 'test-token')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://central.supabase.co/functions/v1/storage',
      expect.anything(),
    )
  })
})
