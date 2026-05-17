/**
 * In-memory CacheStore — for tests and ephemeral environments.
 */

import type { CacheStore, CacheStoreEntry, CacheEntryMeta } from './cacheStore.js'

interface Entry {
  value: Uint8Array
  meta: CacheEntryMeta
}

export class MemoryCacheStore implements CacheStore {
  private stores = new Map<string, Map<string, Entry>>()

  private ns(namespace: string): Map<string, Entry> {
    let m = this.stores.get(namespace)
    if (!m) {
      m = new Map()
      this.stores.set(namespace, m)
    }
    return m
  }

  async get(namespace: string, key: string): Promise<CacheStoreEntry | null> {
    const e = this.ns(namespace).get(key)
    if (!e) return null
    // Defensive copies so callers can't mutate our internals.
    return { value: e.value, meta: { ...e.meta } }
  }

  async put(
    namespace: string, key: string, value: Uint8Array, meta: CacheEntryMeta,
  ): Promise<void> {
    this.ns(namespace).set(key, { value, meta: { ...meta } })
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.ns(namespace).delete(key)
  }

  async *listByLru(
    namespace: string,
  ): AsyncIterable<{ key: string; meta: CacheEntryMeta }> {
    const arr = Array.from(this.ns(namespace).entries())
    arr.sort((a, b) => a[1].meta.lastAccess - b[1].meta.lastAccess)
    for (const [key, e] of arr) yield { key, meta: { ...e.meta } }
  }

  async deleteByTag(namespace: string, tag: string): Promise<void> {
    const m = this.ns(namespace)
    for (const [k, e] of m.entries()) {
      if (e.meta.tag === tag) m.delete(k)
    }
  }

  async totalBytes(namespace: string): Promise<number> {
    let total = 0
    for (const e of this.ns(namespace).values()) total += e.meta.size
    return total
  }

  async entryCount(namespace: string): Promise<number> {
    return this.ns(namespace).size
  }

  async close(): Promise<void> {
    this.stores.clear()
  }
}
