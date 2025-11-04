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
  await stream.sync()
  
  // Create prefix from public key
  const publicKeyBase64 = base64url.encode(Buffer.from(keyPair.publicKey))
  const prefix = `pk/${publicKeyBase64}`
  
  return { stream, prefix, streamId: publicKeyBase64 }
}
