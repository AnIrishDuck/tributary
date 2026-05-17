/**
 * IndexedDB-backed CacheStore.
 *
 * One IndexedDB database (`tributary-cache` by default) with one object store
 * per namespace. Each object store has a `lastAccess` index for cheap LRU
 * iteration and a `tag` index for bulk delete on logout / wipe.
 *
 * Namespaces must be declared up front — IndexedDB schema upgrades require
 * a version bump, which we deliberately avoid in steady-state operation.
 */

import type { CacheStore, CacheStoreEntry, CacheEntryMeta } from './cacheStore.js'

interface IdbRecord {
  key: string
  value: Uint8Array
  size: number
  lastAccess: number
  tag?: string
}

const DEFAULT_DB_NAME = 'tributary-cache'
const DB_VERSION = 1

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

function openDb(dbName: string, namespaces: string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const ns of namespaces) {
        if (!db.objectStoreNames.contains(ns)) {
          const store = db.createObjectStore(ns, { keyPath: 'key' })
          store.createIndex('lastAccess', 'lastAccess', { unique: false })
          store.createIndex('tag', 'tag', { unique: false })
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error(`IndexedDB open blocked for ${dbName}`))
  })
}

export interface IdbCacheStoreOptions {
  dbName?: string
  namespaces: string[]
}

export class IdbCacheStore implements CacheStore {
  private constructor(
    private db: IDBDatabase,
    private namespaces: Set<string>,
  ) {}

  static async open(opts: IdbCacheStoreOptions): Promise<IdbCacheStore> {
    const dbName = opts.dbName ?? DEFAULT_DB_NAME
    const db = await openDb(dbName, opts.namespaces)
    return new IdbCacheStore(db, new Set(opts.namespaces))
  }

  private checkNamespace(namespace: string): void {
    if (!this.namespaces.has(namespace)) {
      throw new Error(`IdbCacheStore: unknown namespace "${namespace}"`)
    }
  }

  async get(namespace: string, key: string): Promise<CacheStoreEntry | null> {
    this.checkNamespace(namespace)
    const tx = this.db.transaction([namespace], 'readonly')
    const req = tx.objectStore(namespace).get(key) as IDBRequest<IdbRecord | undefined>
    const rec = await promisifyRequest(req)
    if (!rec) return null
    return {
      value: rec.value,
      meta: { size: rec.size, lastAccess: rec.lastAccess, tag: rec.tag },
    }
  }

  async put(
    namespace: string, key: string, value: Uint8Array, meta: CacheEntryMeta,
  ): Promise<void> {
    this.checkNamespace(namespace)
    const tx = this.db.transaction([namespace], 'readwrite')
    const rec: IdbRecord = {
      key, value,
      size: meta.size,
      lastAccess: meta.lastAccess,
      tag: meta.tag,
    }
    tx.objectStore(namespace).put(rec)
    await promisifyTransaction(tx)
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.checkNamespace(namespace)
    const tx = this.db.transaction([namespace], 'readwrite')
    tx.objectStore(namespace).delete(key)
    await promisifyTransaction(tx)
  }

  async *listByLru(
    namespace: string,
  ): AsyncIterable<{ key: string; meta: CacheEntryMeta }> {
    this.checkNamespace(namespace)
    // Snapshot the lastAccess-indexed cursor into an array; yielding lazily
    // would risk the IndexedDB transaction completing between yields.
    const records: { key: string; meta: CacheEntryMeta }[] = []
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction([namespace], 'readonly')
      const index = tx.objectStore(namespace).index('lastAccess')
      const cursorReq = index.openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) return
        const v = cursor.value as IdbRecord
        records.push({
          key: v.key,
          meta: { size: v.size, lastAccess: v.lastAccess, tag: v.tag },
        })
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
    for (const r of records) yield r
  }

  async deleteByTag(namespace: string, tag: string): Promise<void> {
    this.checkNamespace(namespace)
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction([namespace], 'readwrite')
      const index = tx.objectStore(namespace).index('tag')
      const cursorReq = index.openCursor(IDBKeyRange.only(tag))
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) return
        cursor.delete()
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
  }

  async totalBytes(namespace: string): Promise<number> {
    this.checkNamespace(namespace)
    let total = 0
    await new Promise<void>((resolve, reject) => {
      const tx = this.db.transaction([namespace], 'readonly')
      const cursorReq = tx.objectStore(namespace).openCursor()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor) return
        total += (cursor.value as IdbRecord).size
        cursor.continue()
      }
      cursorReq.onerror = () => reject(cursorReq.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
    return total
  }

  async entryCount(namespace: string): Promise<number> {
    this.checkNamespace(namespace)
    const tx = this.db.transaction([namespace], 'readonly')
    return promisifyRequest(tx.objectStore(namespace).count() as IDBRequest<number>)
  }

  async close(): Promise<void> {
    this.db.close()
  }
}
