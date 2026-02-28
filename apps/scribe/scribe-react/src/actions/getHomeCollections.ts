import { TributaryClient } from 'tributary-client'
import { getCachedLinkedLibraries, getLinkedLibraries, localMigrations, seedLinkedLibrariesCache } from 'scribe-data'
import { LibraryInfo } from './getLibraries'

/**
 * Load the home collections from the configured home library.
 * Returns null if no home library is configured (signals fallback to getLibraries).
 *
 * Uses the linked_libraries cache on the home stream's local DB so the home
 * page can render immediately without initializing every linked stream.
 * On first load (empty cache), falls back to reading the home stream's
 * collection table and seeds the cache for subsequent loads.
 *
 * Linked streams are NOT initialized here. The sync loop handles stream
 * registration and initialization progressively via round-robin.
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

  const homeLocal = homeStream.local()

  // Ensure local tables (including linked_libraries) exist on the home stream
  await localMigrations(homeLocal)

  // Try the cache first — fast path, no per-library DB queries
  const cached = await getCachedLinkedLibraries(homeLocal)
  if (cached.length > 0) {
    return cached.map(lib => ({
      libraryId: lib.stream_id,
      lastEdited: lib.last_edited,
      libraryTitle: lib.title,
    }))
  }

  // Cache miss — read the collection table and seed the cache.
  // This only happens on first load before the sync loop has run.
  const linkedLibraries = await getLinkedLibraries(homeStream)
  if (linkedLibraries.length === 0) {
    return []
  }

  // Seed the cache so the next load is instant
  await seedLinkedLibrariesCache(homeStream, homeLocal)

  // Register linked streams so the sync loop can find them,
  // but do NOT run localMigrations on each — the sync loop handles that.
  for (const collection of linkedLibraries) {
    if (collection.linked_stream_key) {
      try {
        await client.addWriteKey('scribe', collection.linked_stream_key)
      } catch (err) {
        console.error(`Failed to register linked library ${collection.linked_stream_id}:`, err)
      }
    }
  }

  return linkedLibraries.map(collection => ({
    libraryId: collection.linked_stream_id!,
    lastEdited: null,
    libraryTitle: collection.title,
  }))
}
