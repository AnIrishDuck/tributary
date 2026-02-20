import { TributaryClient } from 'tributary-client'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { initializeStream } from 'scribe-data'

export async function createStream(client: TributaryClient, name: string) {
  // Generate a new key pair
  const keyPair = nacl.sign.keyPair()

  // Add the write key to create a new stream
  const stream = await client.addWriteKey('scribe', keyPair.secretKey)

  // Run migrations and create root collection
  await initializeStream(stream, name)

  // Sync the stream to ensure persistence
  // Using max of 1000 blobs to prevent memory issues
  const syncStatus = await stream.sync(1000)
  console.log(`Stream created and synced: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`)
  
  // Create prefix from public key
  const publicKeyBase64 = base64url.encode(Buffer.from(keyPair.publicKey))
  const prefix = `pk/${publicKeyBase64}`
  const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey))
  
  return { stream, prefix, streamId: publicKeyBase64, privateKeyBase64 }
}
