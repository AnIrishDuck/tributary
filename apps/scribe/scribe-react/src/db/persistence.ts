import { PGliteInterface } from '@electric-sql/pglite'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import {
  SYNC_CONTROL_CHANNEL,
  SYNC_STATUS_CHANNEL,
} from './sync-worker-messages'
import type { SyncControlMessage, SyncStatusOutMessage } from './sync-worker-messages'

/**
 * PGlite database instance backed by a Web Worker.
 *
 * The worker runs PGlite in the leader tab and also hosts the sync engine,
 * which has direct (zero-copy) access to the PGlite instance. The main thread
 * communicates with the sync engine via BroadcastChannels rather than
 * serializing blobs through postMessage.
 */
let dbInstance: PGliteInterface | null = null
let currentDbName: string | null = null

// BroadcastChannels for sync communication (lazy-created)
let controlChannel: BroadcastChannel | null = null
let statusChannel: BroadcastChannel | null = null

/**
 * Get or create the PGlite instance.
 *
 * Always uses PGliteWorker so PGlite runs in a background Web Worker. The
 * worker also hosts the sync engine with direct PGlite access (zero
 * serialization overhead for sync operations).
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
 * Get the BroadcastChannel for sending control messages to the sync worker.
 */
export function getSyncControlChannel(): BroadcastChannel {
  if (!controlChannel) {
    controlChannel = new BroadcastChannel(SYNC_CONTROL_CHANNEL)
  }
  return controlChannel
}

/**
 * Get the BroadcastChannel for receiving status messages from the sync worker.
 */
export function getSyncStatusChannel(): BroadcastChannel {
  if (!statusChannel) {
    statusChannel = new BroadcastChannel(SYNC_STATUS_CHANNEL)
  }
  return statusChannel
}

/**
 * Send a control message to the sync worker.
 */
export function sendSyncControl(msg: SyncControlMessage): void {
  getSyncControlChannel().postMessage(msg)
}

/**
 * Close the PGlite instance
 */
export async function closePGlite(): Promise<void> {
  if (controlChannel) {
    controlChannel.close()
    controlChannel = null
  }
  if (statusChannel) {
    statusChannel.close()
    statusChannel = null
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
