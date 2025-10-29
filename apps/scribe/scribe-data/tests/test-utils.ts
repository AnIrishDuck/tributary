import { Kysely } from 'kysely'
import { KyselyTributary } from 'kysely-tributary'
import { TributaryClient, TributaryStream } from 'tributary-client'
import { FakeServer } from 'tributary-client/src/fakeServer.js'
import nacl from 'tweetnacl'
import { encodeBase64 } from 'tweetnacl-util'
import { PGlite } from '@electric-sql/pglite'

/**
 * Create a test database connection using Tributary with a fake server
 */
export async function createTestDB(): Promise<{ syncedDb: Kysely<any>, localDb: Kysely<any>, client: TributaryClient, stream: TributaryStream, server: FakeServer }> {
  // Create a fake server for testing
  const server = new FakeServer()
  
  // Create an in-memory PGlite database for testing
  const pglite = new PGlite('memory://')
  
  // Create TributaryClient with the in-memory database
  const client = new TributaryClient({
    server,
    db: pglite
  })
  
  // Generate a key pair for testing
  const keyPair = nacl.sign.keyPair()
  
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
