import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'

/**
 * Generates a new key pair for encryption using tweetnacl
 * @returns Object containing public and private keys as base64url encoded strings
 */
export const generateKeyPair = () => {
  // Generate a new key pair
  const keyPair = nacl.sign.keyPair()
  
  // Convert to base64url encoded strings for URL safety
  const publicKeyBase64 = base64url.encode(Buffer.from(keyPair.publicKey))
  const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey))
  
  return {
    publicKey: publicKeyBase64,
    privateKey: privateKeyBase64
  }
}

/**
 * Creates a URL-safe prefix from a public key
 * @param publicKeyBase64 Base64url encoded public key
 * @returns URL-safe string prefix
 */
export const createPrefixFromPublicKey = (publicKeyBase64: string): string => {
  return `pk/${publicKeyBase64}`
}
