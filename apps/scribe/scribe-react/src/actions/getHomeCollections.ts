import { TributaryClient } from 'tributary-client'
import { getLinkedCollections, getLastEditedTime, ensureMigrations } from 'scribe-data'
import { StreamInfo } from './getStreams'

/**
 * Load the home collections from the configured home stream.
 * Returns null if no home stream is configured (signals fallback to getStreams).
 */
export async function getHomeCollections(client: TributaryClient): Promise<StreamInfo[] | null> {
  const homeStreamId = await client.getHomeStream()
  if (!homeStreamId) {
    return null
  }

  const homeStream = await client.get('scribe', homeStreamId)
  if (!homeStream) {
    return null
  }

  const linkedCollections = await getLinkedCollections(homeStream)

  const streamInfos: StreamInfo[] = await Promise.all(
    linkedCollections.map(async (collection) => {
      const linkedStreamId = collection.linked_stream_id!
      const linkedStreamKey = collection.linked_stream_key

      // Register the linked stream and ensure local tables exist
      if (linkedStreamKey) {
        try {
          const stream = await client.addWriteKey('scribe', linkedStreamKey)
          await ensureMigrations(stream, false)
        } catch (err) {
          console.error(`Failed to register linked stream ${linkedStreamId}:`, err)
        }
      }

      // Look up last-edited time from the linked stream's local DB
      let lastEdited: string | null = null
      try {
        const linkedLocalDb = await client.getLocal('scribe', linkedStreamId)
        if (linkedLocalDb) {
          lastEdited = await getLastEditedTime(linkedLocalDb)
        }
      } catch (err) {
        console.error(`Error getting info for linked stream ${linkedStreamId}:`, err)
      }

      return {
        streamId: linkedStreamId,
        lastEdited,
        rootCollectionTitle: collection.title
      }
    })
  )

  return streamInfos
}
