import { PGlite, PGliteInterface } from '@electric-sql/pglite'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import { EncryptedIdbFs } from 'tributary-client/src/encryptedIdbFs'

/**
 * Whether to run PGlite in a background Web Worker or in the foreground
 * (main thread). Foreground avoids worker overhead but blocks the UI during
 * heavy queries; background keeps the main thread free.
 */
const USE_BACKGROUND_WORKER = false

/**
 * PGlite database instance with IndexedDB persistence
 */
let dbInstance: PGliteInterface | null = null
let currentDbName: string | null = null

/**
 * Get or create the PGlite instance.
 *
 * When USE_BACKGROUND_WORKER is true the instance is a PGliteWorker backed by
 * a dedicated Web Worker thread. When false the instance runs directly on the
 * main thread.
 *
 * @param dbName - Name of the IndexedDB database (optional, defaults to 'scribe-db')
 * @param encryptionKey - Optional 32-byte nacl.secretbox key for at-rest encryption.
 *   When provided, all data persisted to IndexedDB is encrypted. Derive this
 *   from the user's login via deriveStorageKey().
 * @returns PGlite-compatible instance
 */
export function getPGlite(dbName?: string, encryptionKey?: Uint8Array): PGliteInterface {
  if (dbInstance) {
    return dbInstance
  }

  const databaseName = dbName || 'scribe-db'
  currentDbName = databaseName

  if (encryptionKey) {
    // Encrypted at-rest storage — uses our custom filesystem
    dbInstance = new PGlite({
      fs: new EncryptedIdbFs(databaseName, encryptionKey) as any,
    })
  } else if (USE_BACKGROUND_WORKER) {
    dbInstance = new PGliteWorker(
      new Worker(new URL('./pglite-worker.ts', import.meta.url), {
        type: 'module',
      }),
      {
        dataDir: `idb://${databaseName}`,
        relaxedDurability: true,
      },
    )
  } else {
    dbInstance = new PGlite({
      dataDir: `idb://${databaseName}`,
      relaxedDurability: true,
    })
  }

  return dbInstance
}

/**
 * Close the PGlite instance
 * Should be called on application shutdown
 */
export async function closePGlite(): Promise<void> {
  if (dbInstance) {
    await dbInstance.close()
    dbInstance = null
    currentDbName = null
  }
}

/**
 * Close PGlite and wipe all IndexedDB databases.
 * Used during logout to ensure no local data persists.
 */
export async function wipePGlite(): Promise<void> {
  await closePGlite()

  // Delete all IndexedDB databases to ensure a clean slate
  if (typeof indexedDB !== 'undefined' && indexedDB.databases) {
    const databases = await indexedDB.databases()
    await Promise.all(
      databases
        .filter((db): db is IDBDatabaseInfo & { name: string } => db.name != null)
        .map((db) => new Promise<void>((resolve) => {
          const req = indexedDB.deleteDatabase(db.name)
          req.onsuccess = () => {
            console.log(`[wipePGlite] deleteDatabase("${db.name}") succeeded`)
            resolve()
          }
          req.onerror = () => {
            console.error(`[wipePGlite] deleteDatabase("${db.name}") failed:`, req.error)
            resolve()
          }
          // onblocked fires when other connections are still open.
          // Wait up to 2s for connections to close (onsuccess/onerror will
          // resolve normally if they do).  If still blocked, resolve anyway
          // so the page reload can proceed — the reload itself will close
          // the lingering connections.
          req.onblocked = () => {
            console.warn(`[wipePGlite] deleteDatabase("${db.name}") blocked — waiting up to 2s`)
            setTimeout(resolve, 2000)
          }
        }))
    )
  }
}

/**
 * Get the database name being used
 */
export function getDatabaseName(): string {
  return currentDbName || 'scribe-db'
}
