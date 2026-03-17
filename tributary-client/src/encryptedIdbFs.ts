/**
 * EncryptedIdbFs — a PGlite Filesystem that encrypts all data at rest in IndexedDB.
 *
 * Architecture:
 *   This wraps PGlite's stock IdbFs (Emscripten IDBFS). IDBFS already handles
 *   the sync between its in-memory FS and IndexedDB — we don't reimplement that.
 *   We intercept the IDBFS IndexedDB operations to encrypt file contents on write
 *   and decrypt on read, by patching the objectStore put/get methods on the
 *   database connection that IDBFS opens.
 *
 *   The in-memory Emscripten FS is inherent to how IDBFS works (Emscripten FS
 *   ops are synchronous; IndexedDB is async). That's not our layer — it's theirs.
 *
 * Encryption:
 *   Each file blob is stored as:  nonce (24 bytes) || nacl.secretbox(data, nonce, key)
 *   Key is a 32-byte nacl.secretbox key derived via HKDF from the user's login.
 */

import nacl from 'tweetnacl'

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

// ── IDBFS interception ──────────────────────────────────────────────────

/**
 * Patch the global indexedDB.open so that when Emscripten's IDBFS opens its
 * database, we intercept put() and get()/getAll() on the FILE_DATA object store
 * to encrypt contents on write and decrypt on read.
 *
 * This is scoped: only databases whose name matches `targetDbPath` are patched.
 * The patch is installed before PGlite init and removed after IDBFS connects.
 */
function installIdbInterceptor(targetDbPath: string, key: Uint8Array): () => void {
  const originalOpen = indexedDB.open.bind(indexedDB)

  indexedDB.open = function patchedOpen(name: string, version?: number): IDBOpenDBRequest {
    const req = version !== undefined ? originalOpen(name, version) : originalOpen(name)

    // Only intercept the IDBFS database for our dataDir
    if (typeof name === 'string' && name.includes(targetDbPath)) {
      req.addEventListener('success', () => {
        const db = req.result
        patchDatabase(db, key)
      })
    }

    return req
  } as typeof indexedDB.open

  // Return cleanup function
  return () => {
    indexedDB.open = originalOpen
  }
}

/**
 * Patch an IDBDatabase so all transactions on FILE_DATA encrypt on put
 * and decrypt on get/getAll/openCursor.
 *
 * IDBFS stores records as: { timestamp, mode, contents: Uint8Array }
 * We encrypt the `contents` field only, leaving metadata intact for IDBFS
 * to do its change-detection diff.
 */
function patchDatabase(db: IDBDatabase, key: Uint8Array): void {
  const originalTransaction = db.transaction.bind(db)

  db.transaction = function patchedTransaction(
    storeNames: string | string[],
    mode?: IDBTransactionMode,
    options?: IDBTransactionOptions
  ): IDBTransaction {
    const tx = originalTransaction(storeNames, mode, options)
    const originalObjectStore = tx.objectStore.bind(tx)

    tx.objectStore = function patchedObjectStore(name: string): IDBObjectStore {
      const store = originalObjectStore(name)

      // Only patch the FILE_DATA store (where IDBFS keeps file contents)
      if (name === 'FILE_DATA') {
        patchObjectStore(store, key)
      }

      return store
    }

    return tx
  } as typeof db.transaction
}

/** IDBFS file record shape */
interface IdbfsRecord {
  timestamp: Date
  mode: number
  contents?: Uint8Array
}

function patchObjectStore(store: IDBObjectStore, key: Uint8Array): void {
  // ── Encrypt on put ──
  const originalPut = store.put.bind(store)
  store.put = function encryptingPut(value: IdbfsRecord, key_?: IDBValidKey): IDBRequest {
    if (value && value.contents instanceof Uint8Array && value.contents.length > 0) {
      value = { ...value, contents: encryptBlob(value.contents, key) }
    }
    return key_ !== undefined ? originalPut(value, key_) : originalPut(value)
  } as typeof store.put

  // ── Decrypt on get ──
  const originalGet = store.get.bind(store)
  store.get = function decryptingGet(query: IDBValidKey | IDBKeyRange): IDBRequest {
    const req = originalGet(query)
    wrapRequestResult(req, key)
    return req
  } as typeof store.get

  // ── Decrypt on getAll ──
  const originalGetAll = store.getAll.bind(store)
  store.getAll = function decryptingGetAll(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number
  ): IDBRequest<IdbfsRecord[]> {
    const req = originalGetAll(query, count) as IDBRequest<IdbfsRecord[]>
    const resultDescriptor = Object.getOwnPropertyDescriptor(
      IDBRequest.prototype, 'result'
    )
    let cachedResult: IdbfsRecord[] | undefined

    Object.defineProperty(req, 'result', {
      get() {
        if (cachedResult !== undefined) return cachedResult
        const raw = resultDescriptor!.get!.call(req)
        if (!Array.isArray(raw)) return raw
        cachedResult = raw.map(r => decryptRecord(r, key))
        return cachedResult
      },
      configurable: true,
    })
    return req
  } as typeof store.getAll

  // ── Decrypt on openCursor ──
  const originalOpenCursor = store.openCursor.bind(store)
  store.openCursor = function decryptingOpenCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection
  ): IDBRequest<IDBCursorWithValue | null> {
    const req = originalOpenCursor(query, direction)
    patchCursorRequest(req, key)
    return req
  } as typeof store.openCursor
}

/** Wrap a single-record IDBRequest to decrypt its result. */
function wrapRequestResult(req: IDBRequest, key: Uint8Array): void {
  const resultDescriptor = Object.getOwnPropertyDescriptor(
    IDBRequest.prototype, 'result'
  )
  let cachedResult: IdbfsRecord | undefined

  Object.defineProperty(req, 'result', {
    get() {
      if (cachedResult !== undefined) return cachedResult
      const raw = resultDescriptor!.get!.call(req) as IdbfsRecord | undefined
      if (!raw) return raw
      cachedResult = decryptRecord(raw, key)
      return cachedResult
    },
    configurable: true,
  })
}

/** Patch a cursor request so each cursor.value is decrypted. */
function patchCursorRequest(req: IDBRequest<IDBCursorWithValue | null>, key: Uint8Array): void {
  const originalOnSuccess = Object.getOwnPropertyDescriptor(req, 'onsuccess')
  const addEventOriginal = req.addEventListener.bind(req)

  req.addEventListener = function patchedAddEvent(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    if (type === 'success' && typeof listener === 'function') {
      const originalListener = listener
      listener = function wrappedListener(this: IDBRequest, event: Event) {
        const cursor = req.result
        if (cursor && cursor.value) {
          const decrypted = decryptRecord(cursor.value, key)
          Object.defineProperty(cursor, 'value', { value: decrypted, configurable: true })
        }
        return originalListener.call(this, event)
      } as EventListener
    }
    return addEventOriginal(type, listener, options)
  } as typeof req.addEventListener

  // Also handle direct onsuccess assignment
  Object.defineProperty(req, 'onsuccess', {
    set(handler: ((this: IDBRequest, ev: Event) => void) | null) {
      if (handler) {
        const originalHandler = handler
        handler = function wrappedHandler(this: IDBRequest, event: Event) {
          const cursor = (this as IDBRequest<IDBCursorWithValue | null>).result
          if (cursor && cursor.value) {
            const decrypted = decryptRecord(cursor.value, key)
            Object.defineProperty(cursor, 'value', { value: decrypted, configurable: true })
          }
          return originalHandler.call(this, event)
        }
      }
      if (originalOnSuccess?.set) {
        originalOnSuccess.set.call(req, handler)
      }
    },
    get() {
      return originalOnSuccess?.get?.call(req)
    },
    configurable: true,
  })
}

function decryptRecord(record: IdbfsRecord, key: Uint8Array): IdbfsRecord {
  if (record && record.contents instanceof Uint8Array && record.contents.length > 0) {
    try {
      return { ...record, contents: decryptBlob(record.contents, key) }
    } catch {
      // If decryption fails, return as-is (may be an unencrypted legacy record)
      return record
    }
  }
  return record
}

// ── EncryptedIdbFs (implements PGlite Filesystem interface) ─────────────

/** Minimal interface for the PGlite instance we receive in init() */
interface PGliteRef {
  Module: {
    FS: {
      filesystems: { IDBFS: Record<string, unknown> }
      mkdir(path: string): void
      mount(fs: Record<string, unknown>, opts: Record<string, unknown>, path: string): void
      symlink(target: string, link: string): void
      syncfs(populate: boolean, callback: (err: Error | null) => void): void
      quit(): void
    }
  }
}

const PGDATA = '/pgdata'

export class EncryptedIdbFs {
  private dataDir: string
  private key: Uint8Array
  private pg: PGliteRef | null = null
  private removeInterceptor: (() => void) | null = null

  /**
   * @param dataDir  Storage name, e.g. "scribe-db". Used as the IDBFS mount path.
   * @param encryptionKey  32-byte nacl.secretbox key (from deriveStorageKey)
   */
  constructor(dataDir: string, encryptionKey: Uint8Array) {
    if (encryptionKey.length !== nacl.secretbox.keyLength) {
      throw new Error(`EncryptedIdbFs: key must be ${nacl.secretbox.keyLength} bytes, got ${encryptionKey.length}`)
    }
    this.dataDir = dataDir
    this.key = encryptionKey
  }

  /**
   * Called by PGlite during construction. Sets up IDBFS mount (same as stock
   * IdbFs) but installs our IndexedDB interceptor first so all file contents
   * are encrypted/decrypted transparently.
   */
  async init(pg: PGliteRef, emscriptenOptions: Record<string, unknown>): Promise<{ emscriptenOpts: Record<string, unknown> }> {
    this.pg = pg
    const dataDir = this.dataDir
    const key = this.key

    // Install interceptor before IDBFS opens its database
    this.removeInterceptor = installIdbInterceptor(dataDir, key)

    // Set up the IDBFS mount exactly like stock IdbFs does
    const existingPreRun = (emscriptenOptions.preRun ?? []) as Array<(mod: PGliteRef['Module']) => void>
    emscriptenOptions.preRun = [
      ...existingPreRun,
      (mod: PGliteRef['Module']) => {
        const FS = mod.FS
        try { FS.mkdir('/pglite') } catch { /* already exists */ }
        FS.mkdir(`/pglite/${dataDir}`)
        FS.mount(FS.filesystems.IDBFS, {}, `/pglite/${dataDir}`)
        try { FS.symlink(`/pglite/${dataDir}`, PGDATA) } catch { /* already exists */ }
      },
    ]

    return { emscriptenOpts: emscriptenOptions }
  }

  /**
   * Pull encrypted data from IndexedDB into the in-memory FS, decrypting
   * transparently via our interceptor.
   */
  async initialSyncFs(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pg!.Module.FS.syncfs(true, (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /**
   * Push in-memory FS changes to IndexedDB, encrypting transparently
   * via our interceptor.
   */
  async syncToFs(_relaxedDurability?: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.pg!.Module.FS.syncfs(false, (err: Error | null) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async dumpTar(_dbname: string): Promise<Blob> {
    throw new Error('EncryptedIdbFs: dumpTar not yet implemented')
  }

  async closeFs(): Promise<void> {
    if (this.removeInterceptor) {
      this.removeInterceptor()
      this.removeInterceptor = null
    }
    // Close the IDBFS database connection
    try {
      const idbfsDbs = this.pg?.Module.FS.filesystems.IDBFS as { dbs?: Record<string, IDBDatabase> }
      const db = idbfsDbs?.dbs?.[`/pglite/${this.dataDir}`]
      if (db) db.close()
    } catch {
      // already closed
    }
    try {
      this.pg?.Module.FS.quit()
    } catch {
      // FS.quit may throw if already shut down
    }
  }
}
