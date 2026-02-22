import { TributaryClient } from 'tributary-client'
import { getLinkedLibraries, getLastEditedTime, localMigrations } from 'scribe-data'
import { LibraryInfo } from './getLibraries'

/**
 * Load the home collections from the configured home library.
 * Returns null if no home library is configured (signals fallback to getLibraries).
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

      // Look up last-edited time from the linked library's local DB
      let lastEdited: string | null = null
      try {
        const linkedLocalDb = await client.getLocal('scribe', linkedStreamId)
        if (linkedLocalDb) {
          lastEdited = await getLastEditedTime(linkedLocalDb)
        }
      } catch (err) {
        console.error(`Error getting info for linked library ${linkedStreamId}:`, err)
      }

      return {
        libraryId: linkedStreamId,
        lastEdited,
        libraryTitle: collection.title
      }
    })
  )

  return libraryInfos
}
