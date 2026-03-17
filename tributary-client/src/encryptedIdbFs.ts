/**
 * EncryptedIdbFs — a PGlite Filesystem that encrypts all data at rest in IndexedDB.
 *
 * Architecture:
 *   Emscripten's FS is synchronous; IndexedDB is async. Every PGlite storage
 *   backend (IdbFs, OpfsAhpFS) therefore keeps files in memory and syncs to
 *   persistent storage at defined points. This is not a "shadow" — the in-memory
 *   FS IS the real filesystem Postgres reads and writes.
 *
 *   We implement PGlite's Filesystem interface directly:
 *     - init():          no-op (default MEMFS is fine)
 *     - initialSyncFs(): EncryptedFileStore.loadAll() → decrypt → FS.writeFile()
 *     - syncToFs():      walk FS → encrypt changed files → EncryptedFileStore.put()
 *     - closeFs():       close the store
 *
 *   EncryptedFileStore is a clean wrapper around IndexedDB that handles
 *   encrypt-on-write and decrypt-on-read using nacl.secretbox. No monkey-patching.
 *
 * Encryption:
 *   Each file blob:  nonce (24 bytes) || nacl.secretbox(plaintext, nonce, key)
 *   Key: 32-byte nacl.secretbox key from deriveStorageKey().
 */

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

// ── EncryptedFileStore ──────────────────────────────────────────────────
//
// Clean wrapper around IndexedDB. Encrypts `contents` on put, decrypts on
// load. Uses the same store name and record shape as Emscripten's IDBFS
// ("FILE_DATA", records keyed by path) so the database is structurally
// compatible — just with encrypted contents.

/** IDBFS-compatible file record. */
export interface FileRecord {
  /** Unix timestamp (epoch seconds) */
  timestamp: number
  /** Emscripten FS mode bits */
  mode: number
  /** File contents (plaintext when in memory, encrypted when in IndexedDB) */
  contents?: Uint8Array
}

const DB_STORE_NAME = 'FILE_DATA'
const DB_VERSION = 21 // match IDBFS version for forward-compat

export class EncryptedFileStore {
  private db: IDBDatabase | null = null

  constructor(
    private dbName: string,
    private key: Uint8Array,
  ) {}

  async open(): Promise<void> {
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
          db.createObjectStore(DB_STORE_NAME)
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }

  /** Load all records, decrypting contents. */
  async loadAll(): Promise<Map<string, FileRecord>> {
    const db = this.db!
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE_NAME, 'readonly')
      const store = tx.objectStore(DB_STORE_NAME)
      const entries = new Map<string, FileRecord>()

      const req = store.openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve(entries)
          return
        }
        const path = cursor.key as string
        const record = cursor.value as FileRecord
        if (record.contents instanceof Uint8Array && record.contents.length > 0) {
          entries.set(path, { ...record, contents: decryptBlob(record.contents, this.key) })
        } else {
          entries.set(path, record)
        }
        cursor.continue()
      }
      req.onerror = () => reject(req.error)
    })
  }

  /** Store records, encrypting contents. */
  async put(records: Map<string, FileRecord>): Promise<void> {
    const db = this.db!
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE_NAME, 'readwrite')
      const store = tx.objectStore(DB_STORE_NAME)
      for (const [path, record] of records) {
        if (record.contents instanceof Uint8Array && record.contents.length > 0) {
          store.put({ ...record, contents: encryptBlob(record.contents, this.key) }, path)
        } else {
          store.put(record, path)
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  /** Remove entries by path. */
  async remove(paths: string[]): Promise<void> {
    const db = this.db!
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE_NAME, 'readwrite')
      const store = tx.objectStore(DB_STORE_NAME)
      for (const path of paths) store.delete(path)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

// ── Emscripten FS helpers ───────────────────────────────────────────────

/** Minimal Emscripten FS interface we rely on. */
interface EmscriptenFS {
  readdir(path: string): string[]
  readFile(path: string): Uint8Array
  writeFile(path: string, data: Uint8Array, opts?: { canOwn?: boolean }): void
  mkdir(path: string): void
  mkdirTree(path: string): void
  stat(path: string): { mtime: Date; mode: number }
  isDir(mode: number): boolean
  isFile(mode: number): boolean
  chmod(path: string, mode: number): void
  utime(path: string, atime: number, mtime: number): void
  lookupPath(path: string): { node: { contents: Uint8Array } }
  quit(): void
}

interface PGliteRef {
  Module: { FS: EmscriptenFS }
}

/**
 * PGlite's data directory inside the Emscripten FS.
 * This matches the constant exported from @electric-sql/pglite internals.
 */
const PGDATA = '/tmp/pglite/base'

/** Recursively collect all file entries under `dir`. */
function walkFs(FS: EmscriptenFS, dir: string, out: Map<string, FileRecord>): void {
  let entries: string[]
  try {
    entries = FS.readdir(dir)
  } catch {
    return
  }
  for (const name of entries) {
    if (name === '.' || name === '..') continue
    const fullPath = `${dir}/${name}`
    try {
      const st = FS.stat(fullPath)
      if (FS.isDir(st.mode)) {
        out.set(fullPath, { timestamp: epochSeconds(st.mtime), mode: st.mode })
        walkFs(FS, fullPath, out)
      } else if (FS.isFile(st.mode)) {
        out.set(fullPath, {
          timestamp: epochSeconds(st.mtime),
          mode: st.mode,
          contents: FS.readFile(fullPath),
        })
      }
    } catch {
      // file vanished between readdir and stat
    }
  }
}

function epochSeconds(d: Date | number): number {
  return typeof d === 'number' ? d : Math.floor(d.getTime() / 1000)
}

// ── EncryptedIdbFs (PGlite Filesystem) ──────────────────────────────────

export class EncryptedIdbFs {
  private store: EncryptedFileStore
  private pg: PGliteRef | null = null
  /** Snapshot of timestamps from the last sync, for change detection. */
  private lastTimestamps: Map<string, number> = new Map()

  /**
   * @param dataDir   Storage name (e.g. "scribe-db")
   * @param encryptionKey  32-byte nacl.secretbox key
   */
  constructor(dataDir: string, encryptionKey: Uint8Array) {
    if (encryptionKey.length !== nacl.secretbox.keyLength) {
      throw new Error(`EncryptedIdbFs: key must be ${nacl.secretbox.keyLength} bytes, got ${encryptionKey.length}`)
    }
    this.store = new EncryptedFileStore(`/pglite/${dataDir}`, encryptionKey)
  }

  /** Called by PGlite during construction. Default MEMFS is fine. */
  async init(pg: PGliteRef, emscriptenOptions: Record<string, unknown>): Promise<{ emscriptenOpts: Record<string, unknown> }> {
    this.pg = pg
    return { emscriptenOpts: emscriptenOptions }
  }

  /**
   * Load encrypted records from IndexedDB, decrypt, and populate the FS.
   * Mirrors what Emscripten IDBFS.storeLocalEntry does.
   */
  async initialSyncFs(): Promise<void> {
    await this.store.open()
    const records = await this.store.loadAll()
    if (records.size === 0) return

    const FS = this.pg!.Module.FS

    for (const [path, entry] of records) {
      if (FS.isDir(entry.mode)) {
        try {
          FS.mkdirTree(path)
        } catch {
          // already exists
        }
        FS.chmod(path, entry.mode)
      } else if (entry.contents) {
        // Ensure parent directories exist
        const parent = path.substring(0, path.lastIndexOf('/'))
        try {
          FS.mkdirTree(parent)
        } catch {
          // already exists
        }
        FS.writeFile(path, entry.contents, { canOwn: true })
        FS.chmod(path, entry.mode)
      }

      const ts = entry.timestamp
      try {
        FS.utime(path, ts, ts)
      } catch {
        // utime may fail on some node types
      }
      this.lastTimestamps.set(path, ts)
    }
  }

  /**
   * Walk the FS, find entries that changed since last sync, encrypt, and
   * write to IndexedDB. Entries that disappeared are removed.
   */
  async syncToFs(_relaxedDurability?: boolean): Promise<void> {
    const FS = this.pg!.Module.FS
    const current = new Map<string, FileRecord>()
    walkFs(FS, PGDATA, current)

    // Diff: find new/changed entries
    const toWrite = new Map<string, FileRecord>()
    for (const [path, entry] of current) {
      const prev = this.lastTimestamps.get(path)
      if (prev === undefined || prev !== entry.timestamp) {
        toWrite.set(path, entry)
      }
    }

    // Diff: find removed entries
    const toRemove: string[] = []
    for (const path of this.lastTimestamps.keys()) {
      if (!current.has(path)) {
        toRemove.push(path)
      }
    }

    // Persist
    if (toWrite.size > 0) await this.store.put(toWrite)
    if (toRemove.length > 0) await this.store.remove(toRemove)

    // Update snapshot
    this.lastTimestamps = new Map()
    for (const [path, entry] of current) {
      this.lastTimestamps.set(path, entry.timestamp)
    }
  }

  async dumpTar(_dbname: string): Promise<Blob> {
    throw new Error('EncryptedIdbFs: dumpTar not yet implemented')
  }

  async closeFs(): Promise<void> {
    this.store.close()
    try {
      this.pg?.Module.FS.quit()
    } catch {
      // already shut down
    }
  }
}
