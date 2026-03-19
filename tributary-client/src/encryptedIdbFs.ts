/**
 * EncryptedIdbFs — a PGlite Filesystem that encrypts all data at rest in IndexedDB.
 *
 * Architecture:
 *   Extends PGlite's IdbFs. In init(), we replace Emscripten's IDBFS with a
 *   thin wrapper that intercepts the two IndexedDB boundary methods:
 *     - storeRemoteEntry: encrypt entry.contents before store.put()
 *     - loadRemoteEntry:  decrypt entry.contents after store.get()
 *
 *   Everything else (mount, syncfs, reconcile, getDB, etc.) passes through
 *   to the real IDBFS unchanged. MEMFS still works with plaintext — Postgres
 *   never sees encrypted data.
 *
 * Encryption:
 *   Each file blob:  nonce (24 bytes) || nacl.secretbox(plaintext, nonce, key)
 *   Key: 32-byte nacl.secretbox key from deriveStorageKey().
 */

import { IdbFs } from '@electric-sql/pglite'
import nacl from 'tweetnacl'

// ── Crypto (pure, testable) ─────────────────────────────────────────────

/**
 * Encrypt a blob: nonce (24 B) || nacl.secretbox(plaintext, nonce, key).
 */
export function encryptBlob(plaintext: Uint8Array, key: Uint8Array): Uint8Array {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const ciphertext = nacl.secretbox(plaintext, nonce, key)
  const out = new Uint8Array(nonce.length + ciphertext.length)
  out.set(nonce)
  out.set(ciphertext, nonce.length)
  return out
}

/**
 * Decrypt a blob produced by encryptBlob. Throws on wrong key or tampering.
 */
export function decryptBlob(encrypted: Uint8Array, key: Uint8Array): Uint8Array {
  if (encrypted.length < nacl.secretbox.nonceLength) {
    throw new Error('EncryptedIdbFs: blob too short to contain a nonce')
  }
  const nonce = encrypted.slice(0, nacl.secretbox.nonceLength)
  const ciphertext = encrypted.slice(nacl.secretbox.nonceLength)
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key)
  if (plaintext === null) {
    throw new Error('EncryptedIdbFs: decryption failed (wrong key or corrupted data)')
  }
  return plaintext
}

// ── IDBFS entry shape ───────────────────────────────────────────────────

/** IDBFS file record as stored in IndexedDB. */
interface IdbfsEntry {
  timestamp: number
  mode: number
  contents?: Uint8Array
}

// ── encryptedIdbfs ──────────────────────────────────────────────────────

/**
 * Wrap an Emscripten IDBFS object with encrypt/decrypt on the IndexedDB boundary.
 *
 * Returns a prototype-derived copy that overrides storeRemoteEntry (encrypt
 * before write) and loadRemoteEntry (decrypt after read). Everything else
 * delegates to the original IDBFS.
 *
 * @param realIdbfs  The Emscripten IDBFS singleton (mod.FS.filesystems.IDBFS)
 * @param key        32-byte nacl.secretbox key
 */
export function encryptedIdbfs(realIdbfs: any, key: Uint8Array): any {
  const wrapped = Object.create(realIdbfs)

  wrapped.storeRemoteEntry = (store: IDBObjectStore, path: string, entry: IdbfsEntry, callback: (err?: any) => void) => {
    const encrypted = { ...entry }
    if (encrypted.contents instanceof Uint8Array && encrypted.contents.length > 0) {
      encrypted.contents = encryptBlob(encrypted.contents, key)
    }
    return realIdbfs.storeRemoteEntry(store, path, encrypted, callback)
  }

  wrapped.loadRemoteEntry = (store: IDBObjectStore, path: string, callback: (err: any, entry?: IdbfsEntry) => void) => {
    return realIdbfs.loadRemoteEntry(store, path, (err: any, entry?: IdbfsEntry) => {
      if (err || !entry) return callback(err, entry)
      if (entry.contents instanceof Uint8Array && entry.contents.length > 0) {
        try {
          entry = { ...entry, contents: decryptBlob(entry.contents, key) }
        } catch (e) {
          return callback(e)
        }
      }
      callback(null, entry)
    })
  }

  return wrapped
}

// ── EncryptedIdbFs ──────────────────────────────────────────────────────

export class EncryptedIdbFs extends IdbFs {
  private encryptionKey: Uint8Array

  /**
   * @param dataDir        Storage name (e.g. "scribe-db")
   * @param encryptionKey  32-byte nacl.secretbox key
   */
  constructor(dataDir: string, encryptionKey: Uint8Array) {
    super(dataDir)
    if (encryptionKey.length !== nacl.secretbox.keyLength) {
      throw new Error(`EncryptedIdbFs: key must be ${nacl.secretbox.keyLength} bytes, got ${encryptionKey.length}`)
    }
    this.encryptionKey = encryptionKey
  }

  async init(pg: any, opts: any): Promise<{ emscriptenOpts: any }> {
    const key = this.encryptionKey
    const result = await super.init(pg, opts)

    const originalPreRun: Array<(mod: any) => void> = result.emscriptenOpts.preRun || []
    result.emscriptenOpts.preRun = originalPreRun.map((fn: (mod: any) => void) => {
      return (mod: any) => {
        fn(mod)
        mod.FS.filesystems.IDBFS = encryptedIdbfs(mod.FS.filesystems.IDBFS, key)
      }
    })

    return result
  }
}
