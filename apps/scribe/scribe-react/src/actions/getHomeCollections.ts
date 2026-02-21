import { TributaryClient } from 'tributary-client'
import { getLinkedCollections, getLastEditedTime, getStreamDisplayName } from 'scribe-data'

export interface HomeCollection {
  title: string
  linkedStreamId: string
  lastEdited: string | null
  synced: boolean
}

/**
 * Load the home collections from the configured home stream.
 * Returns null if no home stream is configured (signals fallback to getStreams).
 */
export async function getHomeCollections(client: TributaryClient): Promise<HomeCollection[] | null> {
  const homeStreamId = await client.getHomeStream()
  if (!homeStreamId) {
    return null
  }

  const homeStream = await client.get('scribe', homeStreamId)
  if (!homeStream) {
    return null
  }

  const linkedCollections = await getLinkedCollections(homeStream)

  const homeCollections: HomeCollection[] = await Promise.all(
    linkedCollections.map(async (collection) => {
      const linkedStreamId = collection.linked_stream_id!
      const linkedStreamKey = collection.linked_stream_key

      // Ensure the linked stream is registered with the client
      if (linkedStreamKey) {
        try {
          await client.addWriteKey('scribe', linkedStreamKey)
        } catch (err) {
          console.error(`Failed to register linked stream ${linkedStreamId}:`, err)
        }
      }

      // Look up last-edited time and sync status
      let lastEdited: string | null = null
      let synced = false
      try {
        const localDb = await client.getLocal('scribe', linkedStreamId)
        if (localDb) {
          lastEdited = await getLastEditedTime(localDb)
          synced = true
        }
      } catch (err) {
        console.error(`Error getting info for linked stream ${linkedStreamId}:`, err)
      }

      return {
        title: collection.title,
        linkedStreamId,
        lastEdited,
        synced
      }
    })
  )

  return homeCollections
}
