import { PGlite } from '@electric-sql/pglite'

/**
 * PGlite database instance with IndexedDB persistence
 * Uses a singleton pattern to prevent multiple WASM instances
 */
let dbInstance: PGlite | null = null

/**
 * Get or create the PGlite instance with IndexedDB persistence
 * @param dbName - Name of the IndexedDB database (optional, defaults to 'scribe-db')
 * @returns PGlite instance
 */
export function getPGlite(dbName?: string): PGlite {
  if (dbInstance) {
    return dbInstance
  }

  const databaseName = dbName || 'scribe-db'
  // Use idb:// prefix for IndexedDB persistence
  dbInstance = new PGlite(`idb://${databaseName}`)

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
  // Extract database name from the instance if available
  const url = dbInstance?.dataDir
  if (url && url.startsWith('idb://')) {
    return url.slice(6) // Remove 'idb://' prefix
  }
  return 'scribe-db'
}
