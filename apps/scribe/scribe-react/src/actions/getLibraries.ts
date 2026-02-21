import { TributaryClient } from 'tributary-client'
import { getLastEditedTime, getLibraryDisplayName } from 'scribe-data'

/**
 * Information about a library including last edit time and display name
 */
export interface LibraryInfo {
  libraryId: string
  lastEdited: string | null // ISO string of last edit time, or null if no notes
  libraryTitle: string | null // Library title, or null (implies "Notes")
}

/**
 * Get all libraries tracked by the TributaryClient
 * @param client The TributaryClient instance
 * @returns Array of library info objects with last edit times
 */
export async function getLibraries(client: TributaryClient): Promise<LibraryInfo[]> {
  const libraryIds = await client.list()

  // Get last edit time for each library
  const libraryInfos: LibraryInfo[] = await Promise.all(
    libraryIds.map(async (libraryId) => {
      try {
        const localDb = await client.getLocal('scribe', libraryId)
        if (!localDb) {
          return { libraryId, lastEdited: null, libraryTitle: null }
        }

        const lastEdited = await getLastEditedTime(localDb)
        const libraryTitle = await getLibraryDisplayName(localDb)

        return { libraryId, lastEdited, libraryTitle }
      } catch (error) {
        console.error(`Error getting info for library ${libraryId}:`, error)
        return { libraryId, lastEdited: null, libraryTitle: null }
      }
    })
  )

  // Sort by most recently edited first
  libraryInfos.sort((a, b) => {
    if (!a.lastEdited && !b.lastEdited) return 0
    if (!a.lastEdited) return 1
    if (!b.lastEdited) return -1
    return new Date(b.lastEdited).getTime() - new Date(a.lastEdited).getTime()
  })

  return libraryInfos
}
