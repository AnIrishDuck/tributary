import { describe, it, expect, beforeEach } from 'vitest'
import 'fake-indexeddb/auto'
import { IdbCacheStore } from '../src/cache/idbCacheStore'
import { wrapEncrypted } from '../src/cache/cacheStore'
import { LruCache } from '../src/cache/lruCache'
import nacl from 'tweetnacl'

const enc = new TextEncoder()
const dec = new TextDecoder()
const stringCodec = {
  encode: (s: string) => enc.encode(s),
  decode: (b: Uint8Array) => dec.decode(b),
}

// Unique DB name per test so fake-indexeddb's persisted state doesn't leak
// across tests in the same suite.
let dbCounter = 0
function uniqueDbName(): string {
  dbCounter++
  return `tributary-cache-test-${Date.now()}-${dbCounter}`
}

describe('IdbCacheStore', () => {
  let dbName: string
  beforeEach(() => { dbName = uniqueDbName() })

  it('round-trips entries', async () => {
    const store = await IdbCacheStore.open({ dbName, namespaces: ['sql'] })
    await store.put('sql', 'a', enc.encode('hello'), { size: 5, lastAccess: 1 })
    const got = await store.get('sql', 'a')
    expect(got).not.toBeNull()
    expect(dec.decode(got!.value)).toBe('hello')
    expect(got!.meta.size).toBe(5)
    expect(got!.meta.lastAccess).toBe(1)
    await store.close()
  })

  it('iterates in LRU (oldest-first) order', async () => {
    const store = await IdbCacheStore.open({ dbName, namespaces: ['sql'] })
    await store.put('sql', 'newest', enc.encode('x'), { size: 1, lastAccess: 30 })
    await store.put('sql', 'oldest', enc.encode('x'), { size: 1, lastAccess: 10 })
    await store.put('sql', 'middle', enc.encode('x'), { size: 1, lastAccess: 20 })

    const order: string[] = []
    for await (const { key } of store.listByLru('sql')) order.push(key)
    expect(order).toEqual(['oldest', 'middle', 'newest'])
    await store.close()
  })

  it('totalBytes and entryCount sum up the namespace', async () => {
    const store = await IdbCacheStore.open({ dbName, namespaces: ['sql'] })
    await store.put('sql', 'a', new Uint8Array(50), { size: 50, lastAccess: 1 })
    await store.put('sql', 'b', new Uint8Array(70), { size: 70, lastAccess: 2 })
    expect(await store.entryCount('sql')).toBe(2)
    expect(await store.totalBytes('sql')).toBe(120)
    await store.close()
  })

  it('deleteByTag removes only matching entries', async () => {
    const store = await IdbCacheStore.open({ dbName, namespaces: ['sql'] })
    await store.put('sql', 'a', enc.encode('A'), { size: 1, lastAccess: 1, tag: 'stream1' })
    await store.put('sql', 'b', enc.encode('B'), { size: 1, lastAccess: 2, tag: 'stream1' })
    await store.put('sql', 'c', enc.encode('C'), { size: 1, lastAccess: 3, tag: 'stream2' })
    await store.put('sql', 'd', enc.encode('D'), { size: 1, lastAccess: 4 })

    await store.deleteByTag('sql', 'stream1')

    expect(await store.get('sql', 'a')).toBeNull()
    expect(await store.get('sql', 'b')).toBeNull()
    expect(await store.get('sql', 'c')).not.toBeNull()
    expect(await store.get('sql', 'd')).not.toBeNull()
    await store.close()
  })

  it('separates namespaces within the same database', async () => {
    const store = await IdbCacheStore.open({ dbName, namespaces: ['sql', 'blob'] })
    await store.put('sql', 'k', enc.encode('sql'), { size: 3, lastAccess: 1 })
    await store.put('blob', 'k', enc.encode('blob'), { size: 4, lastAccess: 1 })
    expect(dec.decode((await store.get('sql', 'k'))!.value)).toBe('sql')
    expect(dec.decode((await store.get('blob', 'k'))!.value)).toBe('blob')
    await store.close()
  })

  it('refuses operations on unknown namespaces', async () => {
    const store = await IdbCacheStore.open({ dbName, namespaces: ['sql'] })
    await expect(
      store.put('blob', 'k', enc.encode('x'), { size: 1, lastAccess: 1 }),
    ).rejects.toThrow(/unknown namespace/)
    await store.close()
  })

  it('persists across reopen', async () => {
    const a = await IdbCacheStore.open({ dbName, namespaces: ['sql'] })
    await a.put('sql', 'k', enc.encode('hello'), { size: 5, lastAccess: 1 })
    await a.close()
    const b = await IdbCacheStore.open({ dbName, namespaces: ['sql'] })
    const got = await b.get('sql', 'k')
    expect(got).not.toBeNull()
    expect(dec.decode(got!.value)).toBe('hello')
    await b.close()
  })

  it('drives a full LruCache end-to-end (eviction + isolation)', async () => {
    const store = await IdbCacheStore.open({ dbName, namespaces: ['sql'] })
    const cache = new LruCache(
      { namespace: 'sql', store, maxEntries: 2, hotSize: 0 },
      stringCodec,
    )
    await cache.put('a', 'A')
    await new Promise(r => setTimeout(r, 2))
    await cache.put('b', 'B')
    await new Promise(r => setTimeout(r, 2))
    await cache.put('c', 'C')
    expect(await cache.get('a')).toBe(null)
    expect(await cache.get('b')).toBe('B')
    expect(await cache.get('c')).toBe('C')
    expect(await store.entryCount('sql')).toBe(2)
    await store.close()
  })

  it('with wrapEncrypted, stores ciphertext on disk and decrypts on read', async () => {
    const inner = await IdbCacheStore.open({ dbName, namespaces: ['sql'] })
    const key = nacl.randomBytes(nacl.secretbox.keyLength)
    const encrypted = wrapEncrypted(inner, key)

    const plaintext = 'CANARY_PHRASE_e8f2a9b7c3d1'
    await encrypted.put('sql', 'a', enc.encode(plaintext), {
      size: plaintext.length, lastAccess: 1,
    })

    // Raw inner read must NOT contain the plaintext.
    const raw = await inner.get('sql', 'a')
    expect(raw).not.toBeNull()
    expect(dec.decode(raw!.value)).not.toContain(plaintext)

    // Wrapped read returns the plaintext.
    const got = await encrypted.get('sql', 'a')
    expect(got).not.toBeNull()
    expect(dec.decode(got!.value)).toBe(plaintext)

    await inner.close()
  })
})
