import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateKeyPair, createPrefixFromPublicKey } from '../src/utils/crypto'
import * as base64url from 'urlsafe-base64'
import nacl from 'tweetnacl'

describe('Stream Creation Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
    // Test the underlying functions that would be used in stream creation
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

  it('should simulate the complete stream creation workflow', () => {
    // This test simulates what would happen in a real application:
    // 1. User clicks "Create New Stream"
    // 2. A key pair is generated using nacl
    // 3. A prefix is created from the public key
    // 4. In a real implementation, the stream would be registered with TributaryClient
    // 5. The user is navigated to the new stream
    
    // Step 1 & 2: Generate key pair (this happens in the component)
    const keyPair = nacl.sign.keyPair()
    
    // Convert to base64url encoded strings for URL safety
    const publicKeyBase64 = base64url.encode(Buffer.from(keyPair.publicKey))
    const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey))
    
    // Verify we got valid keys
    expect(publicKeyBase64).toBeDefined()
    expect(privateKeyBase64).toBeDefined()
    
    // Step 3: Create prefix from public key
    const prefix = createPrefixFromPublicKey(publicKeyBase64)
    
    // Verify the prefix format
    expect(prefix).toMatch(/^pk\//)
    
    // In a real implementation, Step 4 would happen here:
    // - Store the key pair in local storage or keyring
    // - Run database migrations via scribe-data
    // - Initialize the PGLite database
    // - Register the stream with TributaryClient
    
    // Step 5: Navigation would happen in the UI component
    // (tested in NewStreamPage.test.tsx)
    
    // Verify that we have everything needed for the complete workflow
    expect(keyPair).toBeDefined()
    expect(prefix).toBeDefined()
  })
})
