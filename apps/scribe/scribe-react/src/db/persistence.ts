import { PGliteInterface } from '@electric-sql/pglite'
import { PGliteWorker } from '@electric-sql/pglite/worker'

/**
 * PGlite database instance with IndexedDB persistence
 * Uses a multi-tab worker so a single PGlite connection is shared across tabs
 */
let dbInstance: PGliteWorker | null = null
let currentDbName: string | null = null

/**
 * Get or create the PGlite instance backed by a shared multi-tab worker
 * @param dbName - Name of the IndexedDB database (optional, defaults to 'scribe-db')
 * @returns PGlite-compatible instance
 */
export function getPGlite(dbName?: string): PGliteInterface {
  if (dbInstance) {
    return dbInstance
  }

  const databaseName = dbName || 'scribe-db'
  currentDbName = databaseName
  dbInstance = new PGliteWorker(
    new Worker(new URL('./pglite-worker.ts', import.meta.url), {
      type: 'module',
    }),
    {
      dataDir: `idb://${databaseName}`,
    },
  )

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
