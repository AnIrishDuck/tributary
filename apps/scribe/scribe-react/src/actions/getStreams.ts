import { TributaryClient } from 'tributary-client'
import { getLastEditedTime, getStreamDisplayName } from 'scribe-data'

/**
 * Information about a stream including last edit time and display name
 */
export interface StreamInfo {
  streamId: string
  lastEdited: string | null // ISO string of last edit time, or null if no blocks
  rootCollectionTitle: string | null // Root collection title, or null (implies "Notes")
}

/**
 * Get all streams tracked by the TributaryClient
 * @param client The TributaryClient instance
 * @returns Array of stream info objects with last edit times
 */
export async function getStreams(client: TributaryClient): Promise<StreamInfo[]> {
  const streamIds = await client.list()

  // Get last edit time for each stream
  const streamInfos: StreamInfo[] = await Promise.all(
    streamIds.map(async (streamId) => {
      try {
        const localDb = await client.getLocal('scribe', streamId)
        if (!localDb) {
          return { streamId, lastEdited: null, rootCollectionTitle: null }
        }

        const lastEdited = await getLastEditedTime(localDb)
        const rootCollectionTitle = await getStreamDisplayName(localDb)

        return { streamId, lastEdited, rootCollectionTitle }
      } catch (error) {
        console.error(`Error getting info for stream ${streamId}:`, error)
        return { streamId, lastEdited: null, rootCollectionTitle: null }
      }
    })
  )

  // Sort by most recently edited first
  streamInfos.sort((a, b) => {
    if (!a.lastEdited && !b.lastEdited) return 0
    if (!a.lastEdited) return 1
    if (!b.lastEdited) return -1
    return new Date(b.lastEdited).getTime() - new Date(a.lastEdited).getTime()
  })

  return streamInfos
}
