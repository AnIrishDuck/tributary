import { Kysely } from 'kysely'
import { KyselyTributary } from 'kysely-tributary'
import { TributaryClient } from 'tributary-client'
import { FakeServer } from 'tributary-client/src/fakeServer.js'
import nacl from 'tweetnacl'
import { encodeBase64 } from 'tweetnacl-util'

/**
 * Create a test database connection using Tributary with a fake server
 */
export async function createTestDB(): Promise<{ db: Kysely<any>, client: TributaryClient, server: FakeServer }> {
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
  
  // Create Kysely instance with Tributary dialect
  const { dialect } = new KyselyTributary(client)
  const db = new Kysely<any>({ dialect })
  
  return { db, client, server }
}
