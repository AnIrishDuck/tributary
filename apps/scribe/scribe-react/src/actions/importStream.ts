import { TributaryClient } from 'tributary-client'
import * as base64url from 'urlsafe-base64'
import { ensureMigrations } from 'scribe-data'

/**
 * Import an existing stream using a private key
 * @param client The TributaryClient to use for importing
 * @param privateKeyBase64 The private key as a base64url encoded string
 * @returns The imported stream, prefix, and streamId
 */
export async function importStream(client: TributaryClient, privateKeyBase64: string) {
  // Decode the private key
  const privateKey = base64url.decode(privateKeyBase64)
  
  // Add the write key to get or create the stream
  const stream = await client.addWriteKey('scribe', privateKey)

  // Sync FIRST to get all existing data from the server (including stream table creation)
  // Using max of 1 blob initially to quickly get started
  const syncStatus = await stream.sync(1)
  console.log(`Stream imported with initial sync: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`)

  // Run migrations for an EXISTING stream (only creates local tables, isNew=false)
  // The stream tables (block) were already created via sync
  await ensureMigrations(stream, false)

  // Get the local database instance
  const localDb = stream.local()
  
  // Extract the public key from the private key (Ed25519 format)
  // In Ed25519, the public key is in the last 32 bytes of the 64-byte secret key
  const publicKey = new Uint8Array(privateKey.slice(32))
  
  // Convert to base64url for the streamId
  const publicKeyBase64 = base64url.encode(Buffer.from(publicKey))
  
  // Create prefix from public key
  const prefix = `pk/${publicKeyBase64}`

  return { stream, prefix, streamId: publicKeyBase64 }
}
