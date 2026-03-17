/**
 * EncryptedIdbFs — a PGlite Filesystem that encrypts all data at rest in IndexedDB.
 *
 * Architecture:
 *   PGlite runs against the default in-memory Emscripten FS (no IDBFS mount).
 *   On startup (initialSyncFs), we read encrypted file blobs from IndexedDB,
 *   decrypt them with nacl.secretbox, and write them into the Emscripten FS.
 *   After each query (syncToFs), we walk the Emscripten FS, encrypt changed
 *   files, and write them back to IndexedDB.
 *
 *   Queries hit the in-memory FS — zero encryption overhead at query time.
 *   Encryption only happens at the persistence boundary.
 *
 * Encryption:
 *   Each file blob is stored as:  nonce (24 bytes) || nacl.secretbox(data, nonce, key)
 *   Key is a 32-byte nacl.secretbox key derived via HKDF from the user's login.
 */

import nacl from 'tweetnacl'

// ── Types mirroring PGlite internals (structural typing) ────────────────

/** Minimal Emscripten FS interface we rely on */
interface EmscriptenFS {
  readdir(path: string): string[]
  readFile(path: string, opts?: { encoding?: string }): Uint8Array
  writeFile(path: string, data: Uint8Array): void
  mkdir(path: string): void
  stat(path: string): { mode: number }
  isDir(mode: number): boolean
  quit(): void
}

/** Minimal PGlite instance — only what we access */
interface PGliteRef {
  Module: { FS: EmscriptenFS }
}

/** A single file record stored in IndexedDB */
export interface EncryptedFileRecord {
  /** Relative path from PGDATA, e.g. "base/1/12345" */
  path: string
  /** nonce || ciphertext */
  blob: Uint8Array
  /** Epoch ms of last modification (from Emscripten FS stat) */
  mtime: number
}

// ── Crypto helpers (pure, testable) ─────────────────────────────────────

/**
 * Encrypt a file blob.
 * Returns nonce (24 bytes) || nacl.secretbox(plaintext, nonce, key).
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
 * Decrypt a blob produced by encryptBlob.
 * Throws if the auth tag is invalid (wrong key or tampered data).
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

// ── IndexedDB helpers ───────────────────────────────────────────────────

const IDB_STORE = 'files'

function openIdb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'path' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbGetAll(db: IDBDatabase): Promise<EncryptedFileRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly')
    const store = tx.objectStore(IDB_STORE)
    const req = store.getAll()
    req.onsuccess = () => resolve(req.result as EncryptedFileRecord[])
    req.onerror = () => reject(req.error)
  })
}

function idbPutAll(db: IDBDatabase, records: EncryptedFileRecord[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    for (const rec of records) {
      store.put(rec)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function idbClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    const req = store.clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

// ── Emscripten FS tree walker ───────────────────────────────────────────

/** PGDATA is where PGlite stores Postgres data files inside the Emscripten FS */
const PGDATA = '/pgdata'

interface FileEntry {
  path: string       // relative to PGDATA
  data: Uint8Array
  mtime: number
}

function walkEmscriptenFs(FS: EmscriptenFS, dir: string, basePath: string, out: FileEntry[]): void {
  let entries: string[]
  try {
    entries = FS.readdir(dir)
  } catch {
    return // directory doesn't exist yet
  }
  for (const name of entries) {
    if (name === '.' || name === '..') continue
    const fullPath = `${dir}/${name}`
    const relPath = basePath ? `${basePath}/${name}` : name
    try {
      const st = FS.stat(fullPath)
      if (FS.isDir(st.mode)) {
        walkEmscriptenFs(FS, fullPath, relPath, out)
      } else {
        const data = FS.readFile(fullPath)
        out.push({ path: relPath, data, mtime: st.mode /* use mode as proxy; real mtime below */ })
      }
    } catch {
      // skip files that vanish between readdir and stat
    }
  }
}

function ensureParentDirs(FS: EmscriptenFS, relPath: string): void {
  const parts = relPath.split('/')
  let cur = PGDATA
  // Create all directories except the last segment (the filename)
  for (let i = 0; i < parts.length - 1; i++) {
    cur = `${cur}/${parts[i]}`
    try {
      FS.stat(cur)
    } catch {
      FS.mkdir(cur)
    }
  }
}

// ── EncryptedIdbFs (implements PGlite Filesystem interface) ─────────────

export class EncryptedIdbFs {
  private dbName: string
  private key: Uint8Array
  private pg: PGliteRef | null = null
  private idb: IDBDatabase | null = null
  /** Snapshot of mtime per relative path after the last sync, for change detection */
  private lastSnapshot: Map<string, number> = new Map()

  /**
   * @param dbName  IndexedDB database name, e.g. "scribe-db-enc"
   * @param encryptionKey  32-byte nacl.secretbox key (from deriveStorageKey)
   */
  constructor(dbName: string, encryptionKey: Uint8Array) {
    if (encryptionKey.length !== nacl.secretbox.keyLength) {
      throw new Error(`EncryptedIdbFs: key must be ${nacl.secretbox.keyLength} bytes, got ${encryptionKey.length}`)
    }
    this.dbName = dbName
    this.key = encryptionKey
  }

  /**
   * Called by PGlite during construction.
   * We use the default in-memory Emscripten FS — no special mounts needed.
   */
  async init(pg: PGliteRef, emscriptenOptions: Record<string, unknown>): Promise<{ emscriptenOpts: Record<string, unknown> }> {
    this.pg = pg
    return { emscriptenOpts: emscriptenOptions }
  }

  /**
   * Called once after the Emscripten module is ready.
   * Loads encrypted file blobs from IndexedDB, decrypts, and writes into the FS.
   */
  async initialSyncFs(): Promise<void> {
    this.idb = await openIdb(this.dbName)
    const records = await idbGetAll(this.idb)
    if (records.length === 0) return

    const FS = this.pg!.Module.FS

    for (const rec of records) {
      const plaintext = decryptBlob(rec.blob, this.key)
      ensureParentDirs(FS, rec.path)
      FS.writeFile(`${PGDATA}/${rec.path}`, plaintext)
      this.lastSnapshot.set(rec.path, rec.mtime)
    }
  }

  /**
   * Called after each query to persist dirty files.
   * Walks the Emscripten FS, encrypts files, and writes to IndexedDB.
   */
  async syncToFs(_relaxedDurability?: boolean): Promise<void> {
    const FS = this.pg!.Module.FS

    // Collect all current files
    const entries: FileEntry[] = []
    walkEmscriptenFs(FS, PGDATA, '', entries)

    // Build records (encrypt everything — simple PoC; production would diff)
    const records: EncryptedFileRecord[] = []
    const newSnapshot = new Map<string, number>()
    for (const entry of entries) {
      const mtime = Date.now() // use wall clock for change tracking
      newSnapshot.set(entry.path, mtime)
      records.push({
        path: entry.path,
        blob: encryptBlob(entry.data, this.key),
        mtime,
      })
    }

    if (!this.idb) {
      this.idb = await openIdb(this.dbName)
    }

    // Full replace: clear + put (simple PoC; production would diff)
    await idbClear(this.idb)
    if (records.length > 0) {
      await idbPutAll(this.idb, records)
    }

    this.lastSnapshot = newSnapshot
  }

  /**
   * Export database as a tar blob. Delegates to PGlite's built-in tar support.
   * The data in the Emscripten FS is plaintext, so this produces an unencrypted tar.
   */
  async dumpTar(dbname: string): Promise<Blob> {
    // For the PoC, return an empty blob. A full implementation would
    // use the tarUtils from PGlite's internals.
    void dbname
    throw new Error('EncryptedIdbFs: dumpTar not yet implemented')
  }

  /**
   * Close the IndexedDB connection and clean up the Emscripten FS.
   */
  async closeFs(): Promise<void> {
    if (this.idb) {
      this.idb.close()
      this.idb = null
    }
    try {
      this.pg?.Module.FS.quit()
    } catch {
      // FS.quit may throw if already shut down
    }
  }
}
