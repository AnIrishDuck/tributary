import { TributaryClient, TributaryStream } from 'tributary-client';
import { localMigrations, getLinkedLibraries } from 'scribe-data';
import type { Collection } from 'scribe-data';

const CONFIG_APP_ID = 'scribe';

/**
 * Sync the home library. Returns the home stream or null if not configured.
 */
export async function syncHomeLibrary(client: TributaryClient): Promise<TributaryStream | null> {
  const homeStreamId = await client.getHomeStream();
  if (!homeStreamId) {
    return null;
  }
  const homeStream = await client.get(CONFIG_APP_ID, homeStreamId);
  if (!homeStream) {
    return null;
  }
  await homeStream.sync(1000);
  await localMigrations(homeStream.local());
  return homeStream;
}

/**
 * Look up the write key for a library from the home library's linked collections.
 * @param client The home TributaryClient (must have the home library synced)
 * @param libraryPk The public key (stream ID) of the library to find
 * @returns The base64url-encoded write key, or null if not found
 */
export async function getLibraryWriteKey(client: TributaryClient, libraryPk: string): Promise<string | null> {
  const homeStream = await syncHomeLibrary(client);
  if (!homeStream) {
    return null;
  }
  const linkedLibraries = await getLinkedLibraries(homeStream);
  for (const lib of linkedLibraries) {
    if (lib.linked_stream_id === libraryPk && lib.linked_stream_key) {
      return lib.linked_stream_key;
    }
  }
  return null;
}

/**
 * List all linked libraries from the home library.
 * @param client The home TributaryClient (must have the home library synced)
 * @returns Array of linked library collections, or null if no home library
 */
export async function listLinkedLibraries(client: TributaryClient): Promise<Collection[] | null> {
  const homeStream = await syncHomeLibrary(client);
  if (!homeStream) {
    return null;
  }
  return getLinkedLibraries(homeStream);
}
