import { TributaryClient, TributaryStream } from 'tributary-client'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { Kysely } from 'kysely'
import { KyselyTributary } from 'kysely-tributary'

/**
 * Create a test client with a stream for testing
 * Returns the client, stream, and routing prefix
 */
export async function createTestClientWithStream(): Promise<{
  client: TributaryClient,
  stream: TributaryStream,
  streamId: string,
  prefix: string
}> {
  // Create test client (this uses FakeServer internally)
  const { createTestTributaryClient } = await import('../src/context/tributaryContext')
  const { client } = createTestTributaryClient()
  
  // Generate a key pair for the test stream
  const keyPair = nacl.sign.keyPair()
  
  // Add a write key to get a stream
  const stream = await client.addWriteKey('scribe', keyPair.secretKey)
  
  // Run migrations
  const { dialect } = new KyselyTributary(stream)
  const syncedDb = new Kysely<any>({ dialect })
  const { up } = await import('scribe-data')
  await up(syncedDb)
  
  // Create the prefix from the public key using the same logic as NewStreamPage
  const publicKeyBase64 = base64url.encode(Buffer.from(keyPair.publicKey))
  const prefix = `pk/${publicKeyBase64}`
  const streamId = publicKeyBase64
  
  return { client, stream, streamId, prefix }
}
