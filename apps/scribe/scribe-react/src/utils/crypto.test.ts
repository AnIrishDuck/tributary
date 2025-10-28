import { describe, it, expect, vi } from 'vitest'
import { generateKeyPair, createPrefixFromPublicKey } from './crypto'

describe('Crypto Utilities', () => {
  it('should generate a key pair with valid public and private keys', () => {
    const keyPair = generateKeyPair()
    
    // Check that both keys exist
    expect(keyPair.publicKey).toBeDefined()
    expect(keyPair.privateKey).toBeDefined()
    
    // Check that keys are strings
    expect(typeof keyPair.publicKey).toBe('string')
    expect(typeof keyPair.privateKey).toBe('string')
    
    // Check that keys are not empty
    expect(keyPair.publicKey.length).toBeGreaterThan(0)
    expect(keyPair.privateKey.length).toBeGreaterThan(0)
  })

  it('should create a valid prefix from a public key', () => {
    const keyPair = generateKeyPair()
    const prefix = createPrefixFromPublicKey(keyPair.publicKey)
    
    // Check that prefix starts with 'pk/'
    expect(prefix.startsWith('pk/')).toBe(true)
    
    // Check that the rest of the prefix matches the public key
    expect(prefix).toBe(`pk/${keyPair.publicKey}`)
  })
})
