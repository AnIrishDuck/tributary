import { describe, it, expect } from 'vitest'
import nacl from 'tweetnacl'
import { deriveMasterKey, deriveAuthKey, deriveStreamSeed } from '../src/kdf'

describe('KDF', () => {
  const email = 'alice@example.com'
  const password = 'correct-horse-battery-staple'
  const appId = 'scribe'

  describe('deriveMasterKey', () => {
    it('is deterministic — same inputs produce same output', async () => {
      const a = await deriveMasterKey(password, email)
      const b = await deriveMasterKey(password, email)
      expect(a).toEqual(b)
    })

    it('produces 32 bytes', async () => {
      const key = await deriveMasterKey(password, email)
      expect(key).toBeInstanceOf(Uint8Array)
      expect(key.length).toBe(32)
    })

    it('normalizes email case', async () => {
      const lower = await deriveMasterKey(password, 'Alice@Example.COM')
      const upper = await deriveMasterKey(password, 'alice@example.com')
      expect(lower).toEqual(upper)
    })

    it('different passwords produce different keys', async () => {
      const a = await deriveMasterKey('password-a', email)
      const b = await deriveMasterKey('password-b', email)
      expect(a).not.toEqual(b)
    })

    it('different emails produce different keys', async () => {
      const a = await deriveMasterKey(password, 'alice@example.com')
      const b = await deriveMasterKey(password, 'bob@example.com')
      expect(a).not.toEqual(b)
    })
  })

  describe('deriveAuthKey', () => {
    it('is deterministic', async () => {
      const a = await deriveAuthKey(password, email)
      const b = await deriveAuthKey(password, email)
      expect(a).toBe(b)
    })

    it('returns a 44-character base64 string', async () => {
      const key = await deriveAuthKey(password, email)
      expect(typeof key).toBe('string')
      expect(key.length).toBe(44)
      // Verify it is valid base64
      expect(() => atob(key)).not.toThrow()
    })

    it('normalizes email case', async () => {
      const a = await deriveAuthKey(password, 'ALICE@EXAMPLE.COM')
      const b = await deriveAuthKey(password, 'alice@example.com')
      expect(a).toBe(b)
    })
  })

  describe('deriveStreamSeed', () => {
    it('is deterministic', async () => {
      const a = await deriveStreamSeed(password, email, appId)
      const b = await deriveStreamSeed(password, email, appId)
      expect(a).toEqual(b)
    })

    it('produces 32 bytes', async () => {
      const seed = await deriveStreamSeed(password, email, appId)
      expect(seed).toBeInstanceOf(Uint8Array)
      expect(seed.length).toBe(32)
    })

    it('different appIds produce different seeds', async () => {
      const a = await deriveStreamSeed(password, email, 'scribe')
      const b = await deriveStreamSeed(password, email, 'other-app')
      expect(a).not.toEqual(b)
    })

    it('normalizes email case', async () => {
      const a = await deriveStreamSeed(password, 'Alice@Example.COM', appId)
      const b = await deriveStreamSeed(password, 'alice@example.com', appId)
      expect(a).toEqual(b)
    })
  })

  describe('domain separation', () => {
    it('authKey and streamSeed are independent', async () => {
      const authKey = await deriveAuthKey(password, email)
      const seed = await deriveStreamSeed(password, email, appId)
      // authKey is base64 of 32 bytes, decode to compare
      const authBytes = Uint8Array.from(atob(authKey), c => c.charCodeAt(0))
      expect(authBytes).not.toEqual(seed)
    })
  })

  describe('nacl integration', () => {
    it('streamSeed produces a valid Ed25519 keypair via fromSeed', async () => {
      const seed = await deriveStreamSeed(password, email, appId)
      const keyPair = nacl.sign.keyPair.fromSeed(seed)

      expect(keyPair.publicKey).toBeInstanceOf(Uint8Array)
      expect(keyPair.publicKey.length).toBe(32)
      expect(keyPair.secretKey).toBeInstanceOf(Uint8Array)
      expect(keyPair.secretKey.length).toBe(64)

      // Sign and verify round-trip
      const message = new TextEncoder().encode('hello')
      const signature = nacl.sign.detached(message, keyPair.secretKey)
      expect(nacl.sign.detached.verify(message, signature, keyPair.publicKey)).toBe(true)
    })

    it('same inputs always produce the same keypair', async () => {
      const seed1 = await deriveStreamSeed(password, email, appId)
      const seed2 = await deriveStreamSeed(password, email, appId)
      const kp1 = nacl.sign.keyPair.fromSeed(seed1)
      const kp2 = nacl.sign.keyPair.fromSeed(seed2)
      expect(kp1.publicKey).toEqual(kp2.publicKey)
      expect(kp1.secretKey).toEqual(kp2.secretKey)
    })
  })
})
