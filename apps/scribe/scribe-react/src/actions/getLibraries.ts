import { TributaryClient } from 'tributary-client'

/**
 * Information about a library including last edit time and display name
 */
export interface LibraryInfo {
  libraryId: string
  lastEdited: string | null // ISO string of last edit time, or null if no notes
  libraryTitle: string | null // Library title, or null (implies "Notes")
}

/**
 * Get all libraries tracked by the TributaryClient.
 *
 * Returns a lightweight list of library IDs.  Per-library metadata
 * (lastEdited, libraryTitle) is populated by the sync loop and stored
 * in SyncStatus, so this function never queries individual library DBs
 * (which may not have synced yet and would error / block the PGliteWorker).
 *
 * @param client The TributaryClient instance
 * @returns Array of library info objects (metadata fields are null; the
 *   caller merges real values from SyncStatus at render time)
 */
export async function getLibraries(client: TributaryClient): Promise<LibraryInfo[]> {
  const libraryIds = await client.list()

  return libraryIds.map(libraryId => ({
    libraryId,
    lastEdited: null,
    libraryTitle: null,
  }))
}
