import { Kysely } from 'kysely'
import { KyselyTributary } from 'kysely-tributary'
import { TributaryClient, TributaryStream } from 'tributary-client'
import { FakeServer } from 'tributary-client/src/fakeServer.js'
import nacl from 'tweetnacl'
import { encodeBase64 } from 'tweetnacl-util'

/**
 * Create a test database connection using Tributary with a fake server
 */
export async function createTestDB(): Promise<{ syncedDb: Kysely<any>, localDb: Kysely<any>, client: TributaryClient, stream: TributaryStream, server: FakeServer }> {
  // Create a fake server for testing
  const server = new FakeServer()
  
  // Generate a key pair for testing
  const keyPair = nacl.sign.keyPair()
  const privateKeyBase64 = encodeBase64(keyPair.secretKey)
  
  // Create TributaryClient
  const client = new TributaryClient({
    server,
    privateKey: privateKeyBase64,
    collectionId: 'test-scribe-collection'
  })
  
  // Add a write key to get a stream
  const stream = await client.addWriteKey('testapp', keyPair.secretKey)
  
  // For testing purposes, we'll use the same stream for both synced and local operations
  // In a real application, local operations would use TributaryLocal
  const { dialect } = new KyselyTributary(stream)
  const syncedDb = new Kysely<any>({ dialect })
  const { dialect: localDialect } = new KyselyTributary(stream.local())
  const localDb = new Kysely<any>({ dialect: localDialect })
  
  return { syncedDb, localDb, client, stream, server }
}
