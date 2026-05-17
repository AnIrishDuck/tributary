import { describe, it, expect } from 'vitest'
import { LruCache } from '../src/cache/lruCache'
import { MemoryCacheStore } from '../src/cache/memoryCacheStore'
import { wrapEncrypted } from '../src/cache/cacheStore'
import nacl from 'tweetnacl'

const enc = new TextEncoder()
const dec = new TextDecoder()

const stringCodec = {
  encode: (s: string) => enc.encode(s),
  decode: (b: Uint8Array) => dec.decode(b),
}

function jsonCodec<T>() {
  return {
    encode: (v: T) => enc.encode(JSON.stringify(v)),
    decode: (b: Uint8Array) => JSON.parse(dec.decode(b)) as T,
  }
}

describe('LruCache (plaintext)', () => {
  it('round-trips values through the store', async () => {
    const cache = new LruCache(
      { namespace: 'sql', store: new MemoryCacheStore() },
      stringCodec,
    )
    expect(await cache.get('a')).toBe(null)
    await cache.put('a', 'hello')
    expect(await cache.get('a')).toBe('hello')
  })

  it('overwrites prior values for the same key', async () => {
    const cache = new LruCache(
      { namespace: 'sql', store: new MemoryCacheStore() },
      stringCodec,
    )
    await cache.put('a', 'first')
    await cache.put('a', 'second')
    expect(await cache.get('a')).toBe('second')
  })

  it('evicts oldest entries when maxEntries is exceeded', async () => {
    const store = new MemoryCacheStore()
    const cache = new LruCache(
      { namespace: 'sql', store, maxEntries: 3, hotSize: 0 },
      stringCodec,
    )
    await cache.put('a', 'A'); await wait()
    await cache.put('b', 'B'); await wait()
    await cache.put('c', 'C'); await wait()
    await cache.put('d', 'D')
    expect(await cache.get('a')).toBe(null)
    expect(await cache.get('b')).toBe('B')
    expect(await cache.get('c')).toBe('C')
    expect(await cache.get('d')).toBe('D')
    expect(await store.entryCount('sql')).toBe(3)
  })

  it('evicts by byte budget when a single oversized insert blows the limit', async () => {
    const store = new MemoryCacheStore()
    const cache = new LruCache(
      { namespace: 'sql', store, maxBytes: 100, hotSize: 0 },
      stringCodec,
    )
    await cache.put('a', 'x'.repeat(30)); await wait()
    await cache.put('b', 'x'.repeat(30)); await wait()
    await cache.put('c', 'x'.repeat(30)); await wait()
    // Total is 90 bytes — adding 80 should evict older entries until we fit.
    await cache.put('d', 'x'.repeat(80))
    expect(await store.totalBytes('sql')).toBeLessThanOrEqual(100)
    expect(await cache.get('d')).toBe('x'.repeat(80))
    expect(await cache.get('a')).toBe(null)
  })

  it('clearByTag removes only matching entries', async () => {
    const cache = new LruCache(
      { namespace: 'sql', store: new MemoryCacheStore() },
      stringCodec,
    )
    await cache.put('s1-a', 'A', 'stream1')
    await cache.put('s1-b', 'B', 'stream1')
    await cache.put('s2-a', 'X', 'stream2')

    await cache.clearByTag('stream1')

    expect(await cache.get('s1-a')).toBe(null)
    expect(await cache.get('s1-b')).toBe(null)
    expect(await cache.get('s2-a')).toBe('X')
  })

  it('clear empties the namespace', async () => {
    const store = new MemoryCacheStore()
    const cache = new LruCache(
      { namespace: 'sql', store },
      stringCodec,
    )
    await cache.put('a', 'A')
    await cache.put('b', 'B')
    await cache.clear()
    expect(await store.entryCount('sql')).toBe(0)
    expect(await cache.get('a')).toBe(null)
  })

  it('namespaces isolate entries within the same store', async () => {
    const store = new MemoryCacheStore()
    const sql = new LruCache({ namespace: 'sql', store }, stringCodec)
    const blob = new LruCache({ namespace: 'blob', store }, stringCodec)
    await sql.put('k', 'sql-value')
    await blob.put('k', 'blob-value')
    expect(await sql.get('k')).toBe('sql-value')
    expect(await blob.get('k')).toBe('blob-value')
  })

  it('concurrent puts of the same key resolve to one persisted entry', async () => {
    const store = new MemoryCacheStore()
    const cache = new LruCache({ namespace: 'sql', store }, stringCodec)
    await Promise.all([
      cache.put('a', 'one'),
      cache.put('a', 'two'),
      cache.put('a', 'three'),
    ])
    expect(await store.entryCount('sql')).toBe(1)
    expect(await cache.get('a')).not.toBe(null)
  })

  it('serves complex values through a JSON codec', async () => {
    const cache = new LruCache<{ rows: number[] }>(
      { namespace: 'sql', store: new MemoryCacheStore() },
      jsonCodec<{ rows: number[] }>(),
    )
    await cache.put('q', { rows: [1, 2, 3] })
    expect(await cache.get('q')).toEqual({ rows: [1, 2, 3] })
  })
})

describe('LruCache (encrypted)', () => {
  it('round-trips through an encrypted store', async () => {
    const key = nacl.randomBytes(nacl.secretbox.keyLength)
    const store = wrapEncrypted(new MemoryCacheStore(), key)
    const cache = new LruCache({ namespace: 'sql', store }, stringCodec)
    await cache.put('a', 'top secret')
    expect(await cache.get('a')).toBe('top secret')
  })

  it('returns null and deletes when the value cannot be decrypted', async () => {
    const inner = new MemoryCacheStore()
    const key = nacl.randomBytes(nacl.secretbox.keyLength)
    const encrypted = wrapEncrypted(inner, key)
    const cache = new LruCache({ namespace: 'sql', store: encrypted, hotSize: 0 }, stringCodec)
    await cache.put('a', 'plaintext-value')

    // Tamper with the ciphertext directly in the inner store.
    const raw = await inner.get('sql', 'a')
    expect(raw).not.toBeNull()
    raw!.value[raw!.value.length - 1] ^= 0xff
    await inner.put('sql', 'a', raw!.value, raw!.meta)

    expect(await cache.get('a')).toBe(null)
    expect(await inner.get('sql', 'a')).toBe(null)
  })

  it('stores ciphertext, not plaintext', async () => {
    const inner = new MemoryCacheStore()
    const key = nacl.randomBytes(nacl.secretbox.keyLength)
    const cache = new LruCache(
      { namespace: 'sql', store: wrapEncrypted(inner, key), hotSize: 0 },
      stringCodec,
    )
    const plaintext = 'CANARY_PHRASE_e8f2a9b7c3d1'
    await cache.put('a', plaintext)
    const raw = await inner.get('sql', 'a')
    expect(raw).not.toBeNull()
    expect(dec.decode(raw!.value)).not.toContain(plaintext)
  })
})

// Ensure two consecutive puts have distinguishable lastAccess timestamps even
// on hosts where Date.now() can return identical values within the same tick.
async function wait(ms = 2): Promise<void> {
  await new Promise(r => setTimeout(r, ms))
}
