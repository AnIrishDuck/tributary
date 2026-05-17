/**
 * LruCache — namespace-aware, persistent, LRU-bounded key/value cache.
 *
 * Generic over the value type V via a pluggable codec. Knows nothing about
 * SQL or blobs; SQL uses it via `SqlCache`, the future blob cache will use
 * a different namespace and codec.
 *
 * Two simultaneous eviction bounds: `maxEntries` and `maxBytes`. Eviction is
 * driven only by LRU pressure and by explicit `clearByTag` / `clear` on
 * logout / wipe — never by writes elsewhere in the system.
 */

import type { CacheStore, CacheEntryMeta } from './cacheStore.js'

export interface CacheCodec<V> {
  encode(value: V): Uint8Array
  decode(bytes: Uint8Array): V
}

export interface LruCacheOptions {
  namespace: string
  store: CacheStore
  maxEntries?: number
  maxBytes?: number
  /** In-memory mirror size for hot reads. */
  hotSize?: number
}

const DEFAULT_MAX_ENTRIES = 2000
const DEFAULT_MAX_BYTES = 16 * 1024 * 1024
const DEFAULT_HOT_SIZE = 256

export class LruCache<V> {
  private readonly namespace: string
  private readonly store: CacheStore
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly hotSize: number
  private readonly codec: CacheCodec<V>
  /** In-memory mirror. Map iteration order is insertion order, so we use
   *  delete+set on access to move an entry to the "most recent" end. */
  private readonly hot = new Map<string, V>()
  /** Per-key in-flight put serialization. */
  private readonly inflightPuts = new Map<string, Promise<void>>()

  constructor(opts: LruCacheOptions, codec: CacheCodec<V>) {
    this.namespace = opts.namespace
    this.store = opts.store
    this.maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
    this.hotSize = opts.hotSize ?? DEFAULT_HOT_SIZE
    this.codec = codec
  }

  async get(key: string): Promise<V | null> {
    const hotHit = this.hot.get(key)
    if (hotHit !== undefined) {
      this.hot.delete(key)
      this.hot.set(key, hotHit)
      return hotHit
    }
    const entry = await this.store.get(this.namespace, key)
    if (!entry) return null
    const value = this.codec.decode(entry.value)
    this.touchHot(key, value)
    return value
  }

  async put(key: string, value: V, tag?: string): Promise<void> {
    const prior = this.inflightPuts.get(key)
    if (prior) await prior.catch(() => {})
    const p = this.doPut(key, value, tag)
    this.inflightPuts.set(key, p)
    try {
      await p
    } finally {
      if (this.inflightPuts.get(key) === p) this.inflightPuts.delete(key)
    }
  }

  private async doPut(key: string, value: V, tag?: string): Promise<void> {
    const encoded = this.codec.encode(value)
    const meta: CacheEntryMeta = {
      size: encoded.length,
      lastAccess: Date.now(),
      tag,
    }
    await this.store.put(this.namespace, key, encoded, meta)
    this.touchHot(key, value)
    await this.evict()
  }

  /** For logout / wipe only. The runtime never calls this for invalidation. */
  async clearByTag(tag: string): Promise<void> {
    await this.store.deleteByTag(this.namespace, tag)
    // The hot mirror doesn't track tags; clear it wholesale on this rare path.
    this.hot.clear()
  }

  async clear(): Promise<void> {
    const keys: string[] = []
    for await (const { key } of this.store.listByLru(this.namespace)) keys.push(key)
    for (const k of keys) await this.store.delete(this.namespace, k)
    this.hot.clear()
  }

  private async evict(): Promise<void> {
    let entries = await this.store.entryCount(this.namespace)
    let bytes = await this.store.totalBytes(this.namespace)
    if (entries <= this.maxEntries && bytes <= this.maxBytes) return
    for await (const { key, meta } of this.store.listByLru(this.namespace)) {
      if (entries <= this.maxEntries && bytes <= this.maxBytes) break
      await this.store.delete(this.namespace, key)
      this.hot.delete(key)
      entries--
      bytes -= meta.size
    }
  }

  private touchHot(key: string, value: V): void {
    if (this.hot.has(key)) this.hot.delete(key)
    this.hot.set(key, value)
    while (this.hot.size > this.hotSize) {
      const oldest = this.hot.keys().next().value
      if (oldest === undefined) break
      this.hot.delete(oldest)
    }
  }
}
