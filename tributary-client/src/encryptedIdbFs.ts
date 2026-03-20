/**
 * EncryptedIdbFs — a PGlite Filesystem that encrypts all data at rest in IndexedDB.
 *
 * Architecture:
 *   Extends PGlite's IdbFs. In init(), we proxy Emscripten's IDBFS.reconcile()
 *   so that every IndexedDB transaction it opens flows through an encrypting
 *   Proxy chain:
 *
 *     reconcile(src, dst, cb)
 *       → db.transaction()          — proxied to wrap the transaction
 *         → tx.objectStore()        — proxied to wrap the store
 *           → store.put(entry, key) — encrypts entry.contents before write
 *           → store.get(key)        — decrypts entry.contents after read
 *
 *   This avoids monkey-patching storeRemoteEntry/loadRemoteEntry and works
 *   regardless of how Emscripten's internals call those methods (closure,
 *   property lookup, etc.). MEMFS still works with plaintext — Postgres
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

// ── IDB Proxy helpers ───────────────────────────────────────────────────

/**
 * Proxy an IDBRequest so the onsuccess handler receives decrypted contents.
 */
function proxyRequestForDecryption(req: IDBRequest, encKey: Uint8Array): IDBRequest {
  return new Proxy(req, {
    set(target, prop, value) {
      if (prop === 'onsuccess') {
        target.onsuccess = (event: any) => {
          const entry = event.target.result
          if (entry?.contents instanceof Uint8Array && entry.contents.length > 0) {
            try {
              entry.contents = decryptBlob(entry.contents, encKey)
            } catch (e) {
              // Decryption failed — redirect to onerror if set
              if (target.onerror) {
                target.onerror({ target: { error: e }, preventDefault() {} } as any)
              }
              return
            }
          }
          value(event)
        }
        return true
      }
      ;(target as any)[prop] = value
      return true
    },
    get(target, prop) {
      const val = (target as any)[prop]
      return typeof val === 'function' ? val.bind(target) : val
    },
  })
}

/**
 * Proxy an IDBObjectStore: encrypt on put(), decrypt on get().
 */
function proxyStoreForEncryption(store: IDBObjectStore, encKey: Uint8Array): IDBObjectStore {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'put') {
        return (entry: any, path: string) => {
          const encrypted = { ...entry }
          if (encrypted.contents instanceof Uint8Array && encrypted.contents.length > 0) {
            encrypted.contents = encryptBlob(encrypted.contents, encKey)
          }
          return target.put(encrypted, path)
        }
      }
      if (prop === 'get') {
        return (path: string) => proxyRequestForDecryption(target.get(path), encKey)
      }
      const val = (target as any)[prop]
      return typeof val === 'function' ? val.bind(target) : val
    },
  })
}

/**
 * Proxy an IDBTransaction so objectStore() returns an encrypting store.
 */
function proxyTxForEncryption(tx: IDBTransaction, encKey: Uint8Array): IDBTransaction {
  return new Proxy(tx, {
    get(target, prop) {
      if (prop === 'objectStore') {
        return (...args: any[]) => proxyStoreForEncryption(
          (target.objectStore as any)(...args), encKey,
        )
      }
      const val = (target as any)[prop]
      return typeof val === 'function' ? val.bind(target) : val
    },
    set(target, prop, value) {
      ;(target as any)[prop] = value
      return true
    },
  })
}

/**
 * Proxy an IDBDatabase so transaction() returns an encrypting transaction.
 */
function proxyDbForEncryption(db: IDBDatabase, encKey: Uint8Array): IDBDatabase {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'transaction') {
        return (...args: any[]) => proxyTxForEncryption(
          (target.transaction as any)(...args), encKey,
        )
      }
      const val = (target as any)[prop]
      return typeof val === 'function' ? val.bind(target) : val
    },
  })
}

// ── encryptedIdbfs ──────────────────────────────────────────────────────

/**
 * Patch Emscripten's IDBFS.reconcile() to encrypt/decrypt at the IndexedDB
 * boundary.
 *
 * reconcile() receives src and dst sets; the remote set carries an IDBDatabase
 * reference (`.db`). We replace that reference with a Proxy chain that
 * intercepts store.put() (encrypt) and store.get() (decrypt). The original
 * storeRemoteEntry / loadRemoteEntry are never modified.
 *
 * @param idbfs  The Emscripten IDBFS singleton (mod.FS.filesystems.IDBFS)
 * @param key    32-byte nacl.secretbox key
 */
export function encryptedIdbfs(idbfs: any, key: Uint8Array): void {
  const originalReconcile = idbfs.reconcile

  idbfs.reconcile = (src: any, dst: any, callback: (err?: any) => void) => {
    // Wrap the remote set's db with an encrypting proxy.
    // reconcile extracts db via `src.type === 'remote' ? src.db : dst.db`,
    // then passes the IDB object store to storeRemoteEntry / loadRemoteEntry.
    // Our proxy chain intercepts put() and get() on that store.
    const remoteIsSource = src.type === 'remote'
    const wrappedSrc = remoteIsSource
      ? { ...src, db: proxyDbForEncryption(src.db, key) }
      : src
    const wrappedDst = remoteIsSource
      ? dst
      : { ...dst, db: proxyDbForEncryption(dst.db, key) }

    return originalReconcile(wrappedSrc, wrappedDst, callback)
  }
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
        encryptedIdbfs(mod.FS.filesystems.IDBFS, key)
      }
    })

    return result
  }
}
