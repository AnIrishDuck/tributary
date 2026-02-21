import { TributaryClient } from 'tributary-client'
import * as base64url from 'urlsafe-base64'
import { ensureMigrations } from 'scribe-data'

/**
 * Import an existing library using a private key
 * @param client The TributaryClient to use for importing
 * @param privateKeyBase64 The private key as a base64url encoded string
 * @returns The imported library, prefix, and streamId
 */
export async function importLibrary(client: TributaryClient, privateKeyBase64: string) {
  // Decode the private key
  const privateKey = base64url.decode(privateKeyBase64)
  
  // Add the write key to get or create the library
  const stream = await client.addWriteKey('scribe', privateKey)

  // Sync FIRST to get all existing data from the server (including note table creation)
  // Using max of 1 blob initially to quickly get started
  const syncStatus = await stream.sync(1)
  console.log(`Library imported with initial sync: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`)

  // Run migrations for an EXISTING library (only creates local tables, isNew=false)
  // The note tables (block) were already created via sync
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
