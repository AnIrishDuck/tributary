/**
 * EncryptedIdbFs — a PGlite Filesystem that encrypts all data at rest in IndexedDB.
 *
 * Architecture:
 *   Extends PGlite's IdbFs. In init(), we replace Emscripten's built-in IDBFS
 *   with our own complete reimplementation (copied from emscripten libidbfs.js)
 *   that has encryption baked directly into the IndexedDB boundary methods:
 *
 *     - storeRemoteEntry: encrypts entry.contents before store.put()
 *     - loadRemoteEntry:  decrypts entry.contents after store.get()
 *
 *   Because we own the entire IDBFS implementation, all internal method calls
 *   (syncfs → reconcile → store/load) go through our object. No monkey-patching
 *   or proxying needed — we control the full call chain.
 *
 *   MEMFS still works with plaintext — Postgres never sees encrypted data.
 *
 * Encryption:
 *   Each file blob:  nonce (24 bytes) || nacl.secretbox(plaintext, nonce, key)
 *   Key: 32-byte nacl.secretbox key from deriveStorageKey().
 *
 * IDBFS source:
 *   Copied from emscripten src/lib/libidbfs.js (DB_VERSION 21).
 *   All internal IDBFS references replaced with self-referential `self.xxx`.
 *   Runtime FS/MEMFS references captured from the emscripten module at init.
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

// ── Encrypted IDBFS implementation ──────────────────────────────────────
//
// Copied from emscripten src/lib/libidbfs.js with the following changes:
//   1. All `IDBFS.xxx` references → `self.xxx` (self-referential)
//   2. `FS`, `MEMFS` captured from emscripten module at creation time
//   3. `PATH.join2(l, r)` inlined as `l + '/' + r` (sufficient for virtual FS paths)
//   4. Encryption baked into storeRemoteEntry / loadRemoteEntry
//   5. Preprocessor directives (#if ASSERTIONS) removed

/**
 * Create a complete IDBFS-compatible object with encryption baked in.
 *
 * @param fs       The emscripten FS object (mod.FS)
 * @param memfs    The emscripten MEMFS object (mod.MEMFS)
 * @param encKey   32-byte nacl.secretbox key
 */
export function createEncryptedIdbfs(fs: any, memfs: any, encKey: Uint8Array): any {
  const self: any = {
    dbs: {} as Record<string, IDBDatabase>,
    indexedDB: () => {
      return indexedDB
    },
    DB_VERSION: 21,
    DB_STORE_NAME: 'FILE_DATA',

    // ── Auto-persist scheduling ───────────────────────────────────────

    queuePersist: (mount: any) => {
      function onPersistComplete() {
        if (mount.idbPersistState === 'again') startPersist()
        else mount.idbPersistState = 0
      }
      function startPersist() {
        mount.idbPersistState = 'idb'
        self.syncfs(mount, false, onPersistComplete)
      }

      if (!mount.idbPersistState) {
        mount.idbPersistState = setTimeout(startPersist, 0)
      } else if (mount.idbPersistState === 'idb') {
        mount.idbPersistState = 'again'
      }
    },

    // ── Mount ─────────────────────────────────────────────────────────

    mount: (mount: any) => {
      const mnt = memfs.mount(mount)
      if (mount?.opts?.autoPersist) {
        mount.idbPersistState = 0
        const memfs_node_ops = mnt.node_ops
        mnt.node_ops = { ...mnt.node_ops }

        mnt.node_ops.mknod = (parent: any, name: any, mode: any, dev: any) => {
          const node = memfs_node_ops.mknod(parent, name, mode, dev)
          node.node_ops = mnt.node_ops
          node.idbfs_mount = mnt.mount
          node.memfs_stream_ops = node.stream_ops
          node.stream_ops = { ...node.stream_ops }

          node.stream_ops.write = (
            stream: any, buffer: any, offset: any,
            length: any, position: any, canOwn: any,
          ) => {
            stream.node.isModified = true
            return node.memfs_stream_ops.write(
              stream, buffer, offset, length, position, canOwn,
            )
          }

          node.stream_ops.close = (stream: any) => {
            const n = stream.node
            if (n.isModified) {
              self.queuePersist(n.idbfs_mount)
              n.isModified = false
            }
            if (n.memfs_stream_ops.close) return n.memfs_stream_ops.close(stream)
          }

          self.queuePersist(mnt.mount)
          return node
        }

        mnt.node_ops.mkdir = (...args: any[]) => (
          self.queuePersist(mnt.mount), memfs_node_ops.mkdir(...args)
        )
        mnt.node_ops.rmdir = (...args: any[]) => (
          self.queuePersist(mnt.mount), memfs_node_ops.rmdir(...args)
        )
        mnt.node_ops.symlink = (...args: any[]) => (
          self.queuePersist(mnt.mount), memfs_node_ops.symlink(...args)
        )
        mnt.node_ops.unlink = (...args: any[]) => (
          self.queuePersist(mnt.mount), memfs_node_ops.unlink(...args)
        )
        mnt.node_ops.rename = (...args: any[]) => (
          self.queuePersist(mnt.mount), memfs_node_ops.rename(...args)
        )
      }
      return mnt
    },

    // ── Sync ──────────────────────────────────────────────────────────

    syncfs: (mount: any, populate: boolean, callback: (err?: any) => void) => {
      self.getLocalSet(mount, (err: any, local: any) => {
        if (err) return callback(err)

        self.getRemoteSet(mount, (err: any, remote: any) => {
          if (err) return callback(err)

          const src = populate ? remote : local
          const dst = populate ? local : remote

          self.reconcile(src, dst, callback)
        })
      })
    },

    quit: () => {
      for (const value of Object.values(self.dbs) as IDBDatabase[]) {
        value.close()
      }
      self.dbs = {}
    },

    // ── IndexedDB access ──────────────────────────────────────────────

    getDB: (name: string, callback: (err: any, db?: IDBDatabase) => void) => {
      let db = self.dbs[name]
      if (db) {
        return callback(null, db)
      }

      let req: IDBOpenDBRequest
      try {
        req = self.indexedDB().open(name, self.DB_VERSION)
      } catch (e) {
        return callback(e)
      }
      if (!req) {
        return callback('Unable to connect to IndexedDB')
      }

      req.onupgradeneeded = (e: any) => {
        db = e.target.result
        const transaction = e.target.transaction
        let fileStore: IDBObjectStore
        if (db.objectStoreNames.contains(self.DB_STORE_NAME)) {
          fileStore = transaction.objectStore(self.DB_STORE_NAME)
        } else {
          fileStore = db.createObjectStore(self.DB_STORE_NAME)
        }
        if (!fileStore.indexNames.contains('timestamp')) {
          fileStore.createIndex('timestamp', 'timestamp', { unique: false })
        }
      }

      req.onsuccess = () => {
        db = req.result
        self.dbs[name] = db
        callback(null, db)
      }

      req.onerror = (e: any) => {
        callback(e.target.error)
        e.preventDefault()
      }
    },

    // ── Local (MEMFS) operations ──────────────────────────────────────

    getLocalSet: (mount: any, callback: (err: any, result?: any) => void) => {
      const entries: Record<string, any> = {}

      function isRealDir(p: string) {
        return p !== '.' && p !== '..'
      }
      function toAbsolute(root: string) {
        return (p: string) => root + '/' + p
      }

      const check = fs.readdir(mount.mountpoint)
        .filter(isRealDir)
        .map(toAbsolute(mount.mountpoint))

      while (check.length) {
        const path = check.pop()!
        let stat: any
        try {
          stat = fs.lstat(path)
        } catch (e) {
          return callback(e)
        }

        if (fs.isDir(stat.mode)) {
          check.push(
            ...fs.readdir(path).filter(isRealDir).map(toAbsolute(path)),
          )
        }

        entries[path] = { timestamp: stat.mtime }
      }

      return callback(null, { type: 'local', entries })
    },

    getRemoteSet: (mount: any, callback: (err: any, result?: any) => void) => {
      const entries: Record<string, any> = {}

      self.getDB(mount.mountpoint, (err: any, db: IDBDatabase) => {
        if (err) return callback(err)

        try {
          const transaction = db.transaction([self.DB_STORE_NAME], 'readonly')
          transaction.onerror = (e: any) => {
            callback(e.target.error)
            e.preventDefault()
          }

          const store = transaction.objectStore(self.DB_STORE_NAME)
          const index = store.index('timestamp')

          index.openKeyCursor().onsuccess = (event: any) => {
            const cursor = event.target.result
            if (!cursor) {
              return callback(null, { type: 'remote', db, entries })
            }
            entries[cursor.primaryKey] = { timestamp: cursor.key }
            cursor.continue()
          }
        } catch (e) {
          return callback(e)
        }
      })
    },

    loadLocalEntry: (path: string, callback: (err: any, entry?: any) => void) => {
      let stat: any, node: any
      try {
        const lookup = fs.lookupPath(path)
        node = lookup.node
        stat = fs.lstat(path)
      } catch (e) {
        return callback(e)
      }

      if (fs.isDir(stat.mode)) {
        return callback(null, { timestamp: stat.mtime, mode: stat.mode })
      } else if (fs.isLink(stat.mode)) {
        return callback(null, {
          timestamp: stat.mtime, mode: stat.mode, link: node.link,
        })
      } else if (fs.isFile(stat.mode)) {
        node.contents = memfs.getFileDataAsTypedArray(node)
        return callback(null, {
          timestamp: stat.mtime, mode: stat.mode, contents: node.contents,
        })
      } else {
        return callback(new Error('node type not supported'))
      }
    },

    storeLocalEntry: (path: string, entry: any, callback: (err?: any) => void) => {
      try {
        if (fs.isDir(entry.mode)) {
          fs.mkdirTree(path, entry.mode)
        } else if (fs.isLink(entry.mode)) {
          fs.symlink(entry.link, path)
        } else if (fs.isFile(entry.mode)) {
          fs.writeFile(path, entry.contents, { canOwn: true })
        } else {
          return callback(new Error('node type not supported'))
        }
        fs.chmod(path, entry.mode)
        fs.utime(path, entry.timestamp, entry.timestamp)
      } catch (e) {
        return callback(e)
      }
      callback(null)
    },

    removeLocalEntry: (path: string, callback: (err?: any) => void) => {
      try {
        const stat = fs.lstat(path)
        if (fs.isDir(stat.mode)) {
          fs.rmdir(path)
        } else {
          fs.unlink(path)
        }
      } catch (e) {
        return callback(e)
      }
      callback(null)
    },

    // ── Remote (IndexedDB) operations — encryption boundary ──────────

    loadRemoteEntry: (
      store: IDBObjectStore, path: string,
      callback: (err: any, entry?: any) => void,
    ) => {
      const req = store.get(path)
      req.onsuccess = (event: any) => {
        const entry = event.target.result
        if (entry?.contents instanceof Uint8Array && entry.contents.length > 0) {
          try {
            entry.contents = decryptBlob(entry.contents, encKey)
          } catch (e) {
            return callback(e)
          }
        }
        callback(null, entry)
      }
      req.onerror = (e: any) => {
        callback(e.target.error)
        e.preventDefault()
      }
    },

    storeRemoteEntry: (
      store: IDBObjectStore, path: string,
      entry: any, callback: (err?: any) => void,
    ) => {
      const toStore = { ...entry }
      if (toStore.contents instanceof Uint8Array && toStore.contents.length > 0) {
        toStore.contents = encryptBlob(toStore.contents, encKey)
      }
      try {
        const req = store.put(toStore, path)
        req.onsuccess = () => callback()
        req.onerror = (e: any) => {
          callback(e.target.error)
          e.preventDefault()
        }
      } catch (e) {
        callback(e)
      }
    },

    removeRemoteEntry: (
      store: IDBObjectStore, path: string,
      callback: (err?: any) => void,
    ) => {
      const req = store.delete(path)
      req.onsuccess = () => callback()
      req.onerror = (e: any) => {
        callback(e.target.error)
        e.preventDefault()
      }
    },

    // ── Reconcile ─────────────────────────────────────────────────────

    reconcile: (src: any, dst: any, callback: (err?: any) => void) => {
      let total = 0

      const create: string[] = []
      for (const [key, e] of Object.entries(src.entries) as [string, any][]) {
        const e2 = dst.entries[key]
        if (!e2 || (e.timestamp as Date).getTime() !== (e2.timestamp as Date).getTime()) {
          create.push(key)
          total++
        }
      }

      const remove: string[] = []
      for (const key of Object.keys(dst.entries)) {
        if (!src.entries[key]) {
          remove.push(key)
          total++
        }
      }

      if (!total) {
        return callback(null)
      }

      let errored = false
      const db: IDBDatabase = src.type === 'remote' ? src.db : dst.db
      const transaction = db.transaction([self.DB_STORE_NAME], 'readwrite')
      const store = transaction.objectStore(self.DB_STORE_NAME)

      function done(err?: any) {
        if (err && !errored) {
          errored = true
          return callback(err)
        }
      }

      transaction.onerror = transaction.onabort = (e: any) => {
        done(e.target.error)
        e.preventDefault()
      }

      transaction.oncomplete = () => {
        if (!errored) {
          callback(null)
        }
      }

      // Sort ascending so directories are created before their children
      for (const path of create.sort()) {
        if (dst.type === 'local') {
          self.loadRemoteEntry(store, path, (err: any, entry: any) => {
            if (err) return done(err)
            self.storeLocalEntry(path, entry, done)
          })
        } else {
          self.loadLocalEntry(path, (err: any, entry: any) => {
            if (err) return done(err)
            self.storeRemoteEntry(store, path, entry, done)
          })
        }
      }

      // Sort descending so files are deleted before their parent directories
      for (const path of remove.sort().reverse()) {
        if (dst.type === 'local') {
          self.removeLocalEntry(path, done)
        } else {
          self.removeRemoteEntry(store, path, done)
        }
      }
    },
  }

  return self
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
    // Emscripten processes preRun with shift()+unshift(), which reverses the
    // array. The LAST element runs FIRST. We append our hook so it runs
    // before the IdbFs mount hook, ensuring mount.type is our encrypted copy.
    result.emscriptenOpts.preRun = [
      ...originalPreRun,
      (mod: any) => {
        mod.FS.filesystems.IDBFS = createEncryptedIdbfs(mod.FS, mod.MEMFS, key)
      },
    ]

    return result
  }
}
