import { TributaryClient } from 'tributary-client'
import { getLinkedLibraries, localMigrations } from 'scribe-data'
import { LibraryInfo } from './getLibraries'

/**
 * Load the home collections from the configured home library.
 * Returns null if no home library is configured (signals fallback to getLibraries).
 *
 * This function only reads the linked-library list from the home stream's
 * collection table.  Per-library metadata (lastEdited, libraryTitle) is
 * populated by the sync loop and stored in SyncStatus, so the home page
 * never fires independent DB queries that could block the PGliteWorker.
 */
export async function getHomeCollections(client: TributaryClient): Promise<LibraryInfo[] | null> {
  const homeStreamId = await client.getHomeStream()
  if (!homeStreamId) {
    return null
  }

  const homeStream = await client.get('scribe', homeStreamId)
  if (!homeStream) {
    return null
  }

  const linkedLibraries = await getLinkedLibraries(homeStream)

  const libraryInfos: LibraryInfo[] = await Promise.all(
    linkedLibraries.map(async (collection) => {
      const linkedStreamId = collection.linked_stream_id!
      const linkedStreamKey = collection.linked_stream_key

      // Register the linked library and ensure local tables exist
      if (linkedStreamKey) {
        try {
          const stream = await client.addWriteKey('scribe', linkedStreamKey)
          await localMigrations(stream.local())
        } catch (err) {
          console.error(`Failed to register linked library ${linkedStreamId}:`, err)
        }
      }

      // lastEdited is populated by the sync loop (stored in SyncStatus).
      // libraryTitle comes from the linked collection metadata — no per-library query needed.
      return {
        libraryId: linkedStreamId,
        lastEdited: null,
        libraryTitle: collection.title
      }
    })
  )

  return libraryInfos
}
