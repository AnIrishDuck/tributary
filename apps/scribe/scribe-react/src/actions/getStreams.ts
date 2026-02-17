import { TributaryClient } from 'tributary-client'
import { getLastEditedTime } from 'scribe-data'

/**
 * Information about a stream including last edit time
 */
export interface StreamInfo {
  streamId: string
  lastEdited: string | null // ISO string of last edit time, or null if no blocks
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
          return { streamId, lastEdited: null }
        }

        // Use the function from scribe-data to get last edited time
        const lastEdited = await getLastEditedTime(localDb)
        return { streamId, lastEdited }
      } catch (error) {
        console.error(`Error getting last edit time for stream ${streamId}:`, error)
        return { streamId, lastEdited: null }
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
