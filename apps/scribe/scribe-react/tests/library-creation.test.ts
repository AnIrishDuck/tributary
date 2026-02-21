import { describe, it, expect } from 'vitest'
import { generateKeyPair, createPrefixFromPublicKey } from '../src/utils/crypto'
import * as base64url from 'urlsafe-base64'

describe('Library Creation Integration Tests', () => {
  it('should generate key pairs with valid prefixes', () => {
    // Test generating a key pair and creating a prefix from it
    const keyPair = generateKeyPair()
    const prefix = createPrefixFromPublicKey(keyPair.publicKey)
    
    // Verify that the prefix has the expected format
    expect(prefix).toMatch(/^pk\//)
    
    // Extract the public key part
    const publicKeyPart = prefix.substring(3) // Remove 'pk/' prefix
    expect(publicKeyPart).toBeTruthy()
    
    // Verify that it's a valid base64url encoded string
    expect(base64url.validate(publicKeyPart)).toBe(true)
  })

  it('should generate unique key pairs', () => {
    // Generate multiple key pairs
    const keyPairs = Array(3).fill(0).map(() => generateKeyPair())
    
    // Verify all have the correct format
    for (const keyPair of keyPairs) {
      expect(keyPair.publicKey).toBeDefined()
      expect(keyPair.privateKey).toBeDefined()
      expect(base64url.validate(keyPair.publicKey)).toBe(true)
      expect(base64url.validate(keyPair.privateKey)).toBe(true)
    }
    
    // Verify that all public keys are unique
    const publicKeys = keyPairs.map(kp => kp.publicKey)
    const uniquePublicKeys = new Set(publicKeys)
    expect(uniquePublicKeys.size).toBe(publicKeys.length)
    
    // Verify that all private keys are unique
    const privateKeys = keyPairs.map(kp => kp.privateKey)
    const uniquePrivateKeys = new Set(privateKeys)
    expect(uniquePrivateKeys.size).toBe(privateKeys.length)
  })

  it('should properly generate key pairs and prefixes', () => {
    // Test the underlying functions that would be used in library creation
    const keyPair = generateKeyPair()
    
    // Verify that we got both public and private keys
    expect(keyPair.publicKey).toBeDefined()
    expect(keyPair.privateKey).toBeDefined()
    
    // Verify that both keys are base64url encoded strings
    expect(base64url.validate(keyPair.publicKey)).toBe(true)
    expect(base64url.validate(keyPair.privateKey)).toBe(true)
    
    // Test creating a prefix from a public key
    const prefix = createPrefixFromPublicKey(keyPair.publicKey)
    expect(prefix).toMatch(/^pk\//)
    expect(prefix.substring(3)).toBe(keyPair.publicKey)
  })

})
