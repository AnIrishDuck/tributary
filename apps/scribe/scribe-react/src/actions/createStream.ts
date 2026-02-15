import { TributaryClient } from 'tributary-client'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { up } from 'scribe-data'

export async function createStream(client: TributaryClient) {
  // Generate a new key pair
  const keyPair = nacl.sign.keyPair()
  
  // Add the write key to create a new stream
  const stream = await client.addWriteKey('scribe', keyPair.secretKey)

  // Run scribe migrations on new stream
  await up(stream, stream.local())

  // Sync the stream to ensure persistence
  // Using max of 1000 blobs to prevent memory issues
  await stream.sync(1000)
  
  // Create prefix from public key
  const publicKeyBase64 = base64url.encode(Buffer.from(keyPair.publicKey))
  const prefix = `pk/${publicKeyBase64}`
  const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey))
  
  return { stream, prefix, streamId: publicKeyBase64, privateKeyBase64 }
}
