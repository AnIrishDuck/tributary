/**
 * End-to-end validation that EncryptedIdbFs actually hides data at rest.
 *
 * Strategy:
 *   1. Create two PGlite instances — one plain, one encrypted via EncryptedIdbFs.
 *   2. Insert a known "canary" phrase into a table in each.
 *   3. Dump every raw binary value from the corresponding IndexedDB database.
 *   4. Assert the canary IS present in the unencrypted dump
 *      and IS NOT present in the encrypted dump.
 */
import { describe, it, expect } from 'vitest'
import 'fake-indexeddb/auto'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import { EncryptedIdbFs } from '../src/encryptedIdbFs'

// A distinctive string we can search for in raw bytes.
const CANARY = 'CANARY_PHRASE_e8f2a9b7c3d1'

/**
 * Collect all binary `contents` fields from every record in an IndexedDB
 * database. PGlite's IdbFs stores Emscripten filesystem entries as objects
 * with a `contents: Uint8Array` property — this grabs them all.
 */
function dumpIndexedDBBinary(dbName: string): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const chunks: Uint8Array[] = []
      const storeNames = Array.from(db.objectStoreNames)
      if (storeNames.length === 0) {
        db.close()
        resolve([])
        return
      }
      const tx = db.transaction(storeNames, 'readonly')
      let pending = storeNames.length
      for (const storeName of storeNames) {
        const store = tx.objectStore(storeName)
        const cursor = store.openCursor()
        cursor.onsuccess = function () {
          const c = cursor.result
          if (c) {
            const val = c.value
            if (val?.contents instanceof Uint8Array && val.contents.length > 0) {
              chunks.push(val.contents)
            }
            c.continue()
          } else {
            pending--
            if (pending === 0) {
              db.close()
              resolve(chunks)
            }
          }
        }
        cursor.onerror = () => {
          pending--
          if (pending === 0) {
            db.close()
            resolve(chunks)
          }
        }
      }
    }
  })
}

/** Check whether `haystack` contains the UTF-8 encoded `needle`. */
function containsString(haystack: Uint8Array, needle: string): boolean {
  const encoded = new TextEncoder().encode(needle)
  outer: for (let i = 0; i <= haystack.length - encoded.length; i++) {
    for (let j = 0; j < encoded.length; j++) {
      if (haystack[i + j] !== encoded[j]) continue outer
    }
    return true
  }
  return false
}

function anyContainsString(chunks: Uint8Array[], needle: string): boolean {
  return chunks.some(chunk => containsString(chunk, needle))
}

describe('encryption at rest: canary phrase visibility', () => {
  it('canary is visible in raw IndexedDB without encryption', async () => {
    const db = new PGlite({ dataDir: 'idb://test-canary-plain' })
    await db.exec(`CREATE TABLE IF NOT EXISTS notes (id SERIAL PRIMARY KEY, body TEXT)`)
    await db.exec(`INSERT INTO notes (body) VALUES ('${CANARY}')`)
    await db.close()

    const chunks = await dumpIndexedDBBinary('/pglite/test-canary-plain')
    expect(chunks.length).toBeGreaterThan(0)
    expect(anyContainsString(chunks, CANARY)).toBe(true)
  }, 60_000)

  it('canary is NOT visible in raw IndexedDB with encryption', async () => {
    const key = nacl.randomBytes(nacl.secretbox.keyLength)
    const db = new PGlite({
      fs: new EncryptedIdbFs('test-canary-encrypted', key) as any,
    })
    await db.exec(`CREATE TABLE IF NOT EXISTS notes (id SERIAL PRIMARY KEY, body TEXT)`)
    await db.exec(`INSERT INTO notes (body) VALUES ('${CANARY}')`)
    await db.close()

    const chunks = await dumpIndexedDBBinary('/pglite/test-canary-encrypted')
    expect(chunks.length).toBeGreaterThan(0)
    expect(anyContainsString(chunks, CANARY)).toBe(false)
  }, 60_000)
})
