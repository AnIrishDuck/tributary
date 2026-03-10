import { TributaryClient, TributaryStream, TributaryLocal } from 'tributary-client'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { syncedMigrations, localMigrations } from './migrations.js'
import { createCollection, getLibrary, getLinkedLibraries } from './collection.js'
import { LinkedLibrary } from './types.js'

/**
 * Internal helper: run synced + local migrations and create the root collection.
 */
async function initLibrary(stream: TributaryStream, name: string): Promise<void> {
  await syncedMigrations(stream)
  await localMigrations(stream.local())
  await createCollection(stream, { title: name, inserter: 'user' })
}

/**
 * Create the home library for a new user.
 *
 * - Registers the key pair
 * - Runs synced + local migrations and creates the root collection
 * - Syncs to the server
 * - Sets the stream as the home stream
 *
 * @returns The stream and its streamId
 */
export async function createHomeLibrary(
  client: TributaryClient,
  name: string,
  keyPair: { publicKey: Uint8Array; secretKey: Uint8Array }
): Promise<{ stream: TributaryStream; streamId: string }> {
  const stream = await client.addWriteKey('scribe', keyPair.secretKey)
  await initLibrary(stream, name)
  await stream.sync(1000)

  const streamId = base64url.encode(Buffer.from(keyPair.publicKey))
  await client.setHomeStream(streamId)

  return { stream, streamId }
}

/**
 * Create a new (non-home) library and link it into the home library.
 *
 * - Generates a new key pair
 * - Runs synced + local migrations and creates the root collection
 * - Syncs the new library
 * - Links it into the home library as a child collection
 * - Syncs the home library
 *
 * @returns The stream, streamId, private key, and URL prefix
 */
export async function createLibrary(
  client: TributaryClient,
  name: string,
  homeStream: TributaryStream
): Promise<{ stream: TributaryStream; streamId: string; privateKeyBase64: string; prefix: string }> {
  const kp = nacl.sign.keyPair()

  const stream = await client.addWriteKey('scribe', kp.secretKey)
  await initLibrary(stream, name)
  await stream.sync(1000)

  const streamId = base64url.encode(Buffer.from(kp.publicKey))
  const privateKeyBase64 = base64url.encode(Buffer.from(kp.secretKey))
  const prefix = `pk/${streamId}`

  // Link into the home library
  const rootCollection = await getLibrary(homeStream)
  if (rootCollection) {
    await createCollection(homeStream, {
      title: name,
      parent_collection_uuid: rootCollection.collection_uuid,
      inserter: 'user',
      linked_stream_id: streamId,
      linked_stream_key: privateKeyBase64,
    })
    await homeStream.sync(1000)
  }

  return { stream, streamId, privateKeyBase64, prefix }
}

/**
 * Import an existing library using a private key.
 *
 * - Registers the key
 * - Syncs to pull existing data (including synced tables)
 * - Runs local migrations only (synced tables arrive via sync)
 * - Links the library into the home library so it persists across sessions
 *
 * @returns The stream, streamId, and URL prefix
 */
export async function importLibrary(
  client: TributaryClient,
  privateKeyBase64: string
): Promise<{ stream: TributaryStream; streamId: string; prefix: string }> {
  const privateKey = base64url.decode(privateKeyBase64)

  const stream = await client.addWriteKey('scribe', privateKey)
  await stream.sync(1000)
  await localMigrations(stream.local())

  // Extract the public key (last 32 bytes of Ed25519 secret key)
  const publicKey = new Uint8Array(privateKey.slice(32))
  const streamId = base64url.encode(Buffer.from(publicKey))
  const prefix = `pk/${streamId}`

  // Link into the home library so the import survives logout/login
  const homeStreamId = await client.getHomeStream()
  if (homeStreamId) {
    const homeStream = await client.get('scribe', homeStreamId)
    if (homeStream) {
      const rootCollection = await getLibrary(homeStream)
      if (rootCollection) {
        // Derive a display name from the imported library's root collection
        let title = 'Imported Library'
        try {
          const lib = await getLibrary(stream)
          if (lib?.title) title = lib.title
        } catch { /* use default */ }

        await createCollection(homeStream, {
          title,
          parent_collection_uuid: rootCollection.collection_uuid,
          inserter: 'user',
          linked_stream_id: streamId,
          linked_stream_key: privateKeyBase64,
        })
        await homeStream.sync(1000)
      }
    }
  }

  return { stream, streamId, prefix }
}

/**
 * Upsert a linked library cache entry on the home stream's local DB.
 * Called by the sync loop after syncing a linked library.
 *
 * @param homeLocal The TributaryLocal instance for the home stream
 * @param data The linked library metadata to cache
 */
export async function upsertLinkedLibrary(
  homeLocal: TributaryLocal,
  data: {
    stream_id: string
    title: string
    last_edited: string | null
    sync_current_index: number
    sync_final_index: number
    last_synced_at: string | null
  }
): Promise<void> {
  const now = new Date().toISOString()
  await homeLocal.exec(
    `INSERT INTO linked_libraries (stream_id, title, last_edited, sync_current_index, sync_final_index, last_synced_at, cached_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (stream_id)
     DO UPDATE SET title = $2, last_edited = $3, sync_current_index = $4, sync_final_index = $5, last_synced_at = $6, cached_at = $7`,
    [data.stream_id, data.title, data.last_edited, data.sync_current_index, data.sync_final_index, data.last_synced_at, now]
  )
}

/**
 * Get all cached linked libraries from the home stream's local DB.
 * Returns an empty array if the table doesn't exist or has no rows.
 *
 * @param homeLocal The TributaryLocal instance for the home stream
 * @returns Array of cached linked library records, sorted by title
 */
export async function getCachedLinkedLibraries(
  homeLocal: TributaryLocal
): Promise<LinkedLibrary[]> {
  try {
    const result = await homeLocal.query(
      `SELECT * FROM linked_libraries ORDER BY title`,
      []
    )
    return (result.rows || []) as LinkedLibrary[]
  } catch {
    // Table may not exist yet on older clients
    return []
  }
}

/**
 * Populate the linked_libraries cache from the home stream's collection table.
 * Inserts entries for all linked collections that don't already have a cache row.
 * This bootstraps the cache so the home page can render immediately on first load.
 *
 * @param homeStream The TributaryStream for the home library
 * @param homeLocal The TributaryLocal for the home library
 */
export async function seedLinkedLibrariesCache(
  homeStream: TributaryStream,
  homeLocal: TributaryLocal
): Promise<void> {
  const linked = await getLinkedLibraries(homeStream)
  const now = new Date().toISOString()

  for (const col of linked) {
    if (!col.linked_stream_id) continue
    // Only insert if not already cached (don't overwrite sync-populated data)
    await homeLocal.exec(
      `INSERT INTO linked_libraries (stream_id, title, last_edited, sync_current_index, sync_final_index, last_synced_at, cached_at)
       VALUES ($1, $2, NULL, 0, 0, NULL, $3)
       ON CONFLICT (stream_id) DO NOTHING`,
      [col.linked_stream_id, col.title, now]
    )
  }
}
