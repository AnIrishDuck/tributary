import { TributaryClient, TributaryStream } from 'tributary-client'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { syncedMigrations, localMigrations } from './migrations.js'
import { createCollection, getLibrary } from './collection.js'

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
  const streamId = base64url.encode(Buffer.from(keyPair.publicKey))

  // Set home stream ID before addWriteKey so the client can route
  // the home stream's data to the memory database when configured.
  await client.setHomeStream(streamId)

  const stream = await client.addWriteKey('scribe', keyPair.secretKey)
  await initLibrary(stream, name)
  await stream.sync(1000)

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

  return { stream, streamId, prefix }
}
