import { useState, useEffect } from 'react'
import { TributaryStream } from 'tributary-client'

/** Module-level cache: blobHash → objectUrl */
const blobCache = new Map<string, string>()

/** LRU tracking: most recently used hashes at the end */
const lruOrder: string[] = []

const MAX_CACHE_SIZE = 200

function evictIfNeeded() {
  while (blobCache.size > MAX_CACHE_SIZE && lruOrder.length > 0) {
    const oldest = lruOrder.shift()!
    const url = blobCache.get(oldest)
    if (url) {
      URL.revokeObjectURL(url)
      blobCache.delete(oldest)
    }
  }
}

function touchLru(hash: string) {
  const idx = lruOrder.indexOf(hash)
  if (idx !== -1) lruOrder.splice(idx, 1)
  lruOrder.push(hash)
}

export interface UseBlobResult {
  objectUrl: string | null
  loading: boolean
  error: Error | null
}

/**
 * Download and cache a blob as an object URL.
 *
 * Maintains a module-level Map cache so blobs persist across mounts
 * within the same page session. LRU eviction kicks in at 200 entries.
 */
export function useBlob(
  blobHash: string | null,
  stream: TributaryStream | null,
): UseBlobResult {
  const [objectUrl, setObjectUrl] = useState<string | null>(
    blobHash ? blobCache.get(blobHash) ?? null : null,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!blobHash || !stream) {
      setObjectUrl(null)
      setLoading(false)
      setError(null)
      return
    }

    // Already cached
    const cached = blobCache.get(blobHash)
    if (cached) {
      touchLru(blobHash)
      setObjectUrl(cached)
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    stream
      .blob()
      .download(blobHash)
      .then((data) => {
        if (cancelled) return
        const blob = new Blob([data])
        const url = URL.createObjectURL(blob)
        blobCache.set(blobHash, url)
        touchLru(blobHash)
        evictIfNeeded()
        setObjectUrl(url)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err : new Error(String(err)))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [blobHash, stream])

  return { objectUrl, loading, error }
}

/** Clear the blob cache. Exported for testing. */
export function clearBlobCache() {
  for (const url of blobCache.values()) {
    URL.revokeObjectURL(url)
  }
  blobCache.clear()
  lruOrder.length = 0
}
