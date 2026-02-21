import { TributaryClient } from 'tributary-client'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { initializeLibrary } from 'scribe-data'

export async function createLibrary(
  client: TributaryClient,
  name: string,
  keyPair?: { publicKey: Uint8Array; secretKey: Uint8Array }
) {
  // Use provided key pair or generate a new one
  const kp = keyPair ?? nacl.sign.keyPair()

  // Add the write key to create a new library
  const stream = await client.addWriteKey('scribe', kp.secretKey)

  // Run migrations and create root collection
  await initializeLibrary(stream, name)

  // Sync the library to ensure persistence
  // Using max of 1000 blobs to prevent memory issues
  const syncStatus = await stream.sync(1000)
  console.log(`Library created and synced: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`)
  
  // Create prefix from public key
  const publicKeyBase64 = base64url.encode(Buffer.from(kp.publicKey))
  const prefix = `pk/${publicKeyBase64}`
  const privateKeyBase64 = base64url.encode(Buffer.from(kp.secretKey))
  
  return { stream, prefix, streamId: publicKeyBase64, privateKeyBase64 }
}
