import { describe, it, expect } from 'vitest'
import nacl from 'tweetnacl'
import { encryptBlob, decryptBlob } from '../src/encryptedIdbFs'
import { deriveMasterKey, deriveStorageKey, deriveAuthKey, deriveStreamSeed } from '../src/kdf'

// ── Blob encryption / decryption ────────────────────────────────────────

describe('encryptBlob / decryptBlob', () => {
  const key = nacl.randomBytes(nacl.secretbox.keyLength) // 32 bytes

  it('round-trips plaintext through encrypt then decrypt', () => {
    const plaintext = new TextEncoder().encode('Hello, encrypted PGlite!')
    const encrypted = encryptBlob(plaintext, key)
    const decrypted = decryptBlob(encrypted, key)
    expect(decrypted).toEqual(plaintext)
  })

  it('handles empty plaintext', () => {
    const plaintext = new Uint8Array(0)
    const encrypted = encryptBlob(plaintext, key)
    const decrypted = decryptBlob(encrypted, key)
    expect(decrypted).toEqual(plaintext)
  })

  it('handles large blobs (1 MB)', () => {
    const plaintext = nacl.randomBytes(1024 * 1024)
    const encrypted = encryptBlob(plaintext, key)
    const decrypted = decryptBlob(encrypted, key)
    expect(decrypted).toEqual(plaintext)
  })

  it('ciphertext is longer than plaintext by nonce + auth tag', () => {
    const plaintext = new Uint8Array(100)
    const encrypted = encryptBlob(plaintext, key)
    // nacl.secretbox overhead = 24 (nonce) + 16 (Poly1305 tag)
    expect(encrypted.length).toBe(100 + 24 + 16)
  })

  it('produces different ciphertext each time (random nonce)', () => {
    const plaintext = new TextEncoder().encode('same input')
    const a = encryptBlob(plaintext, key)
    const b = encryptBlob(plaintext, key)
    // Nonces differ, so ciphertext must differ
    expect(a).not.toEqual(b)
    // But both decrypt to the same plaintext
    expect(decryptBlob(a, key)).toEqual(plaintext)
    expect(decryptBlob(b, key)).toEqual(plaintext)
  })

  it('rejects decryption with wrong key', () => {
    const plaintext = new TextEncoder().encode('secret data')
    const encrypted = encryptBlob(plaintext, key)
    const wrongKey = nacl.randomBytes(nacl.secretbox.keyLength)
    expect(() => decryptBlob(encrypted, wrongKey)).toThrow('decryption failed')
  })

  it('rejects tampered ciphertext', () => {
    const plaintext = new TextEncoder().encode('integrity check')
    const encrypted = encryptBlob(plaintext, key)
    // Flip a byte in the ciphertext (after the nonce)
    const tampered = new Uint8Array(encrypted)
    tampered[nacl.secretbox.nonceLength + 5] ^= 0xff
    expect(() => decryptBlob(tampered, tampered.length > 0 ? key : key)).toThrow('decryption failed')
  })

  it('rejects truncated blob', () => {
    const plaintext = new TextEncoder().encode('truncation test')
    const encrypted = encryptBlob(plaintext, key)
    const truncated = encrypted.slice(0, encrypted.length - 10)
    expect(() => decryptBlob(truncated, key)).toThrow('decryption failed')
  })

  it('rejects blob shorter than nonce length', () => {
    const tooShort = new Uint8Array(10) // less than 24-byte nonce
    expect(() => decryptBlob(tooShort, key)).toThrow('too short')
  })

  it('ciphertext does not contain plaintext substring', () => {
    const secret = 'SUPER_SECRET_DATABASE_PASSWORD_12345'
    const plaintext = new TextEncoder().encode(secret)
    const encrypted = encryptBlob(plaintext, key)
    // The encrypted blob should not contain the plaintext bytes
    const encryptedStr = new TextDecoder().decode(encrypted)
    expect(encryptedStr).not.toContain(secret)
  })
})

// ── Binary data preservation ────────────────────────────────────────────

describe('binary data preservation', () => {
  const key = nacl.randomBytes(nacl.secretbox.keyLength)

  it('preserves all byte values 0x00–0xFF', () => {
    const plaintext = new Uint8Array(256)
    for (let i = 0; i < 256; i++) plaintext[i] = i
    const decrypted = decryptBlob(encryptBlob(plaintext, key), key)
    expect(decrypted).toEqual(plaintext)
  })

  it('preserves Postgres-like page data (8KB blocks)', () => {
    // Simulate a Postgres 8KB page with a header and data
    const page = new Uint8Array(8192)
    // Page header magic
    page[0] = 0x00; page[1] = 0x00; page[2] = 0x00; page[3] = 0x01
    // Fill body with pattern
    for (let i = 24; i < 8192; i++) page[i] = i & 0xff
    const decrypted = decryptBlob(encryptBlob(page, key), key)
    expect(decrypted).toEqual(page)
  })
})

// ── Key derivation (deriveStorageKey) ───────────────────────────────────

describe('deriveStorageKey', () => {
  const email = 'alice@example.com'
  const password = 'correct-horse-battery-staple'

  it('produces 32 bytes (nacl.secretbox.keyLength)', async () => {
    const key = await deriveStorageKey(password, email)
    expect(key).toBeInstanceOf(Uint8Array)
    expect(key.length).toBe(32)
    expect(key.length).toBe(nacl.secretbox.keyLength)
  })

  it('is deterministic', async () => {
    const a = await deriveStorageKey(password, email)
    const b = await deriveStorageKey(password, email)
    expect(a).toEqual(b)
  })

  it('normalizes email case', async () => {
    const a = await deriveStorageKey(password, 'Alice@Example.COM')
    const b = await deriveStorageKey(password, 'alice@example.com')
    expect(a).toEqual(b)
  })

  it('different passwords produce different keys', async () => {
    const a = await deriveStorageKey('password-a', email)
    const b = await deriveStorageKey('password-b', email)
    expect(a).not.toEqual(b)
  })

  it('different emails produce different keys', async () => {
    const a = await deriveStorageKey(password, 'alice@example.com')
    const b = await deriveStorageKey(password, 'bob@example.com')
    expect(a).not.toEqual(b)
  })
})

// ── Domain separation ───────────────────────────────────────────────────

describe('domain separation', () => {
  const email = 'alice@example.com'
  const password = 'correct-horse-battery-staple'

  it('storageKey differs from authKey', async () => {
    const storageKey = await deriveStorageKey(password, email)
    const authKey = await deriveAuthKey(password, email)
    const authBytes = Uint8Array.from(atob(authKey), c => c.charCodeAt(0))
    expect(storageKey).not.toEqual(authBytes)
  })

  it('storageKey differs from streamSeed', async () => {
    const storageKey = await deriveStorageKey(password, email)
    const streamSeed = await deriveStreamSeed(password, email, 'scribe')
    expect(storageKey).not.toEqual(streamSeed)
  })

  it('storageKey works as a nacl.secretbox key for encrypt/decrypt', async () => {
    const key = await deriveStorageKey(password, email)
    const plaintext = new TextEncoder().encode('test data for storage encryption')
    const encrypted = encryptBlob(plaintext, key)
    const decrypted = decryptBlob(encrypted, key)
    expect(decrypted).toEqual(plaintext)
  })
})

// ── Performance sanity checks ───────────────────────────────────────────

describe('performance', () => {
  const key = nacl.randomBytes(nacl.secretbox.keyLength)

  it('encrypts 1 MB in under 500ms', () => {
    const data = nacl.randomBytes(1024 * 1024)
    const start = performance.now()
    encryptBlob(data, key)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(500)
  })

  it('decrypts 1 MB in under 500ms', () => {
    const data = nacl.randomBytes(1024 * 1024)
    const encrypted = encryptBlob(data, key)
    const start = performance.now()
    decryptBlob(encrypted, key)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(500)
  })

  it('encrypts 10 MB in under 2000ms', () => {
    const data = nacl.randomBytes(10 * 1024 * 1024)
    const start = performance.now()
    encryptBlob(data, key)
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(2000)
  })
})

// ── EncryptedIdbFs constructor validation ───────────────────────────────

describe('EncryptedIdbFs constructor', () => {
  // Dynamic import to avoid pulling in IndexedDB at module level
  it('rejects keys that are not 32 bytes', async () => {
    const { EncryptedIdbFs } = await import('../src/encryptedIdbFs')
    expect(() => new EncryptedIdbFs('test-db', new Uint8Array(16))).toThrow('key must be 32 bytes')
    expect(() => new EncryptedIdbFs('test-db', new Uint8Array(64))).toThrow('key must be 32 bytes')
  })

  it('accepts a valid 32-byte key', async () => {
    const { EncryptedIdbFs } = await import('../src/encryptedIdbFs')
    const key = nacl.randomBytes(32)
    const fs = new EncryptedIdbFs('test-db', key)
    expect(fs).toBeTruthy()
  })
})
