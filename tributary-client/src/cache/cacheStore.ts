/**
 * CacheStore — pluggable persistence backend for the generic LruCache.
 *
 * Stores opaque Uint8Array payloads keyed by (namespace, key) with a small
 * amount of metadata used for LRU eviction and tag-based bulk delete on
 * logout / wipe. Stores never inspect the bytes they hold.
 */

import { encryptBlob, decryptBlob } from '../encryptedIdbFs.js'

export interface CacheEntryMeta {
  /** Bytes of the stored `value` (after any wrapping like encryption). */
  size: number
  /** ms epoch — LRU ordering. */
  lastAccess: number
  /** Free-form tag (e.g. streamId), used by `deleteByTag` on logout / wipe. */
  tag?: string
}

export interface CacheStoreEntry {
  value: Uint8Array
  meta: CacheEntryMeta
}

export interface CacheStore {
  get(namespace: string, key: string): Promise<CacheStoreEntry | null>
  put(namespace: string, key: string, value: Uint8Array, meta: CacheEntryMeta): Promise<void>
  delete(namespace: string, key: string): Promise<void>
  /** Iterate entries in LRU order (oldest first) — used for eviction. */
  listByLru(namespace: string): AsyncIterable<{ key: string; meta: CacheEntryMeta }>
  /** Bulk-delete by tag — used by clearByTag (logout / wipe), NOT for invalidation. */
  deleteByTag(namespace: string, tag: string): Promise<void>
  totalBytes(namespace: string): Promise<number>
  entryCount(namespace: string): Promise<number>
  close(): Promise<void>
}

/**
 * Wrap a CacheStore so values are encrypted on write and decrypted on read.
 *
 * Metadata is intentionally NOT encrypted — `size` drives eviction and
 * timestamps are not sensitive. Only the `value` bytes are.
 *
 * A decrypt failure (corruption, key rotation) returns `null` from `get` and
 * lazily deletes the offending entry — callers see a normal miss.
 */
export function wrapEncrypted(store: CacheStore, key: Uint8Array): CacheStore {
  return {
    async get(namespace, k) {
      const entry = await store.get(namespace, k)
      if (!entry) return null
      try {
        const plain = decryptBlob(entry.value, key)
        return { value: plain, meta: entry.meta }
      } catch {
        await store.delete(namespace, k).catch(() => {})
        return null
      }
    },
    async put(namespace, k, value, meta) {
      const encrypted = encryptBlob(value, key)
      await store.put(namespace, k, encrypted, { ...meta, size: encrypted.length })
    },
    delete: (ns, k) => store.delete(ns, k),
    listByLru: (ns) => store.listByLru(ns),
    deleteByTag: (ns, tag) => store.deleteByTag(ns, tag),
    totalBytes: (ns) => store.totalBytes(ns),
    entryCount: (ns) => store.entryCount(ns),
    close: () => store.close(),
  }
}
