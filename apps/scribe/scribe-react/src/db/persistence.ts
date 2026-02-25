import { PGlite, PGliteInterface } from '@electric-sql/pglite'
import { PGliteWorker } from '@electric-sql/pglite/worker'

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
 * In-memory PGlite instance for the home library.
 * The home library is re-synced from the server on each page load.
 */
let homeDbInstance: PGliteInterface | null = null

/**
 * Get or create the PGlite instance.
 *
 * When USE_BACKGROUND_WORKER is true the instance is a PGliteWorker backed by
 * a dedicated Web Worker thread. When false the instance runs directly on the
 * main thread.
 *
 * @param dbName - Name of the IndexedDB database (optional, defaults to 'scribe-db')
 * @returns PGlite-compatible instance
 */
export function getPGlite(dbName?: string): PGliteInterface {
  if (dbInstance) {
    return dbInstance
  }

  const databaseName = dbName || 'scribe-db'
  currentDbName = databaseName

  if (USE_BACKGROUND_WORKER) {
    dbInstance = new PGliteWorker(
      new Worker(new URL('./pglite-worker.ts', import.meta.url), {
        type: 'module',
      }),
      {
        dataDir: `idb://${databaseName}`,
      },
    )
  } else {
    dbInstance = new PGlite({
      dataDir: `idb://${databaseName}`,
    })
  }

  return dbInstance
}

/**
 * Get or create the in-memory PGlite instance for the home library.
 * The home library uses memory:// so it re-syncs from the server on each page load.
 */
export function getHomePGlite(): PGliteInterface {
  if (homeDbInstance) {
    return homeDbInstance
  }
  homeDbInstance = new PGlite('memory://')
  return homeDbInstance
}

/**
 * Close the PGlite instances
 * Should be called on application shutdown
 */
export async function closePGlite(): Promise<void> {
  if (homeDbInstance) {
    await homeDbInstance.close()
    homeDbInstance = null
  }
  if (dbInstance) {
    await dbInstance.close()
    dbInstance = null
    currentDbName = null
  }
}

/**
 * Close PGlite and wipe all IndexedDB databases.
 * Used during logout to ensure no local data persists.
 * The in-memory home database is also closed (its data is already ephemeral).
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
          req.onsuccess = () => resolve()
          req.onerror = () => resolve()
          req.onblocked = () => resolve()
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
