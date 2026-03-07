import { TributaryClient, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { syncedMigrations, localMigrations, createCollection } from 'scribe-data'

/**
 * Create a test TributaryClient with an in-memory database and fake server.
 */
export function createTestClient(server?: FakeServer): { client: TributaryClient, server: FakeServer } {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  return { client, server: s }
}

/**
 * Create a home library with linked libraries for testing.
 *
 * Sets up:
 * 1. A home library (with root collection and linked collections)
 * 2. One or more child libraries that are linked from the home library
 *
 * Returns the home client, the child library details, and the shared server.
 */
export async function createTestHomeWithLibraries(libraryNames: string[] = ['My Notes']): Promise<{
  homeClient: TributaryClient
  server: FakeServer
  libraries: Array<{
    name: string
    streamId: string
    writeKey: string
    keyPair: { publicKey: Uint8Array; secretKey: Uint8Array }
  }>
}> {
  const server = new FakeServer()

  // Create the home client
  const { client: homeClient } = createTestClient(server)

  // Generate a key pair for the home library
  const homeKeyPair = nacl.sign.keyPair()
  const homeStream = await homeClient.addWriteKey('scribe', homeKeyPair.secretKey)
  const homeStreamId = base64url.encode(Buffer.from(homeKeyPair.publicKey))
  await homeClient.setHomeStream(homeStreamId)

  // Initialize the home library (creates block table, collection table, root collection)
  await syncedMigrations(homeStream)
  await localMigrations(homeStream.local())
  await createCollection(homeStream, { title: 'Home', inserter: 'user' })
  await homeStream.sync(1000)

  // Create child libraries and link them from the home library
  const libraries = []
  for (const name of libraryNames) {
    const keyPair = nacl.sign.keyPair()
    const streamId = base64url.encode(Buffer.from(keyPair.publicKey))
    const writeKey = base64url.encode(Buffer.from(keyPair.secretKey))

    // Initialize the child library on the same server
    const { client: childClient } = createTestClient(server)
    const childStream = await childClient.addWriteKey('scribe', keyPair.secretKey)
    await syncedMigrations(childStream)
    await localMigrations(childStream.local())
    await createCollection(childStream, { title: name, inserter: 'user' })
    await childStream.sync(1000)

    // Get the root collection of the home library so we can link under it
    const rootResult = await homeStream.query(
      'SELECT collection_uuid FROM collection WHERE parent_collection_uuid IS NULL',
      []
    )
    const rootUuid = (rootResult.rows[0] as any).collection_uuid

    // Create a linked collection in the home library pointing to this child library
    await createCollection(homeStream, {
      title: name,
      parent_collection_uuid: rootUuid,
      inserter: 'test',
      linked_stream_id: streamId,
      linked_stream_key: writeKey,
    })

    await homeStream.sync(1000)

    libraries.push({ name, streamId, writeKey, keyPair })
  }

  return { homeClient, server, libraries }
}
