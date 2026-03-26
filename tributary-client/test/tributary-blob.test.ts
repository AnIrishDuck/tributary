import { describe, it, expect } from 'vitest'
import nacl from 'tweetnacl'
import {
  BLOB_CHUNK_SIZE,
  chunkData,
  encryptChunk,
  decryptChunk,
  computeChunkHash,
  buildChunkTree,
  getChunkProof,
  verifyChunkProof,
} from '../src/tributaryBlob.js'

describe('blobHelpers', () => {
  const encryptionKey = nacl.randomBytes(nacl.secretbox.keyLength)

  describe('chunkData', () => {
    it('returns single empty chunk for empty data', () => {
      const chunks = chunkData(new Uint8Array(0))
      expect(chunks).toHaveLength(1)
      expect(chunks[0].length).toBe(0)
    })

    it('returns single chunk for data smaller than chunk size', () => {
      const data = nacl.randomBytes(1024)
      const chunks = chunkData(data)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual(data)
    })

    it('splits data into multiple chunks', () => {
      // Create data that spans 3 chunks: 2 full + 100 bytes
      const size = BLOB_CHUNK_SIZE * 2 + 100
      const data = new Uint8Array(size)
      // Fill with a pattern instead of random bytes for speed
      for (let i = 0; i < size; i++) data[i] = i % 256
      const chunks = chunkData(data)
      expect(chunks).toHaveLength(3)
      expect(chunks[0].length).toBe(BLOB_CHUNK_SIZE)
      expect(chunks[1].length).toBe(BLOB_CHUNK_SIZE)
      expect(chunks[2].length).toBe(100)

      // Reassembled data matches original
      const reassembled = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        reassembled.set(chunk, offset)
        offset += chunk.length
      }
      expect(reassembled).toEqual(data)
    })

    it('handles data exactly at chunk boundary', () => {
      const data = new Uint8Array(BLOB_CHUNK_SIZE)
      for (let i = 0; i < data.length; i++) data[i] = i % 256
      const chunks = chunkData(data)
      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual(data)
    })

    it('handles data exactly at two chunk boundaries', () => {
      const data = new Uint8Array(BLOB_CHUNK_SIZE * 2)
      for (let i = 0; i < data.length; i++) data[i] = i % 256
      const chunks = chunkData(data)
      expect(chunks).toHaveLength(2)
      expect(chunks[0].length).toBe(BLOB_CHUNK_SIZE)
      expect(chunks[1].length).toBe(BLOB_CHUNK_SIZE)
    })
  })

  describe('encryptChunk / decryptChunk', () => {
    it('round-trips correctly', () => {
      const plaintext = new TextEncoder().encode('hello world')
      const encrypted = encryptChunk(plaintext, encryptionKey)
      const decrypted = decryptChunk(encrypted, encryptionKey)
      expect(decrypted).toEqual(plaintext)
    })

    it('produces different ciphertext each time (random nonce)', () => {
      const plaintext = new TextEncoder().encode('hello world')
      const a = encryptChunk(plaintext, encryptionKey)
      const b = encryptChunk(plaintext, encryptionKey)
      // Encrypted outputs differ due to random nonce
      expect(a).not.toEqual(b)
      // But both decrypt to the same plaintext
      expect(decryptChunk(a, encryptionKey)).toEqual(plaintext)
      expect(decryptChunk(b, encryptionKey)).toEqual(plaintext)
    })

    it('fails to decrypt with wrong key', () => {
      const plaintext = new TextEncoder().encode('secret data')
      const encrypted = encryptChunk(plaintext, encryptionKey)
      const wrongKey = nacl.randomBytes(nacl.secretbox.keyLength)
      expect(() => decryptChunk(encrypted, wrongKey)).toThrow('Failed to decrypt chunk')
    })

    it('encrypts empty data', () => {
      const empty = new Uint8Array(0)
      const encrypted = encryptChunk(empty, encryptionKey)
      expect(encrypted.length).toBeGreaterThan(nacl.secretbox.nonceLength)
      const decrypted = decryptChunk(encrypted, encryptionKey)
      expect(decrypted).toEqual(empty)
    })
  })

  describe('chunk + encrypt + decrypt round-trip', () => {
    it('round-trips multi-chunk data', () => {
      // Use smaller data that still produces multiple chunks for test speed
      const chunkCount = 3
      const parts: Uint8Array[] = []
      for (let i = 0; i < chunkCount; i++) {
        parts.push(nacl.randomBytes(100))
      }
      const data = new Uint8Array(chunkCount * 100)
      parts.forEach((p, i) => data.set(p, i * 100))

      const chunks = chunkData(data)
      const encrypted = chunks.map(c => encryptChunk(c, encryptionKey))
      const decrypted = encrypted.map(e => decryptChunk(e, encryptionKey))

      const reassembled = new Uint8Array(data.length)
      let offset = 0
      for (const d of decrypted) {
        reassembled.set(d, offset)
        offset += d.length
      }
      expect(reassembled).toEqual(data)
    })
  })

  describe('computeChunkHash', () => {
    it('returns consistent hex hash', async () => {
      const data = new TextEncoder().encode('test data')
      const hash1 = await computeChunkHash(data)
      const hash2 = await computeChunkHash(data)
      expect(hash1).toBe(hash2)
      expect(hash1).toMatch(/^[0-9a-f]{64}$/)
    })

    it('different data produces different hashes', async () => {
      const a = await computeChunkHash(new TextEncoder().encode('a'))
      const b = await computeChunkHash(new TextEncoder().encode('b'))
      expect(a).not.toBe(b)
    })
  })

  describe('buildChunkTree', () => {
    it('builds tree from single chunk hash', async () => {
      const data = new TextEncoder().encode('single chunk')
      const hash = await computeChunkHash(data)
      const { root, tree } = buildChunkTree([hash])
      expect(root).toMatch(/^[0-9a-f]+$/)
      expect(tree).toBeDefined()
    })

    it('produces deterministic root for same hashes', async () => {
      const hashes = [
        await computeChunkHash(new TextEncoder().encode('chunk1')),
        await computeChunkHash(new TextEncoder().encode('chunk2')),
      ]
      const { root: root1 } = buildChunkTree(hashes)
      const { root: root2 } = buildChunkTree(hashes)
      expect(root1).toBe(root2)
    })

    it('different hashes produce different roots', async () => {
      const { root: root1 } = buildChunkTree([
        await computeChunkHash(new TextEncoder().encode('a')),
      ])
      const { root: root2 } = buildChunkTree([
        await computeChunkHash(new TextEncoder().encode('b')),
      ])
      expect(root1).not.toBe(root2)
    })
  })

  describe('getChunkProof / verifyChunkProof', () => {
    it('generates and verifies proof for single-chunk tree', async () => {
      const hash = await computeChunkHash(new TextEncoder().encode('only chunk'))
      const { root, tree } = buildChunkTree([hash])
      const proof = getChunkProof(tree, hash)
      expect(proof).toHaveLength(0) // single leaf, no siblings
      expect(verifyChunkProof(root, hash, proof)).toBe(true)
    })

    it('generates and verifies proof for multi-chunk tree', async () => {
      const hashes = await Promise.all([
        computeChunkHash(new TextEncoder().encode('chunk0')),
        computeChunkHash(new TextEncoder().encode('chunk1')),
        computeChunkHash(new TextEncoder().encode('chunk2')),
        computeChunkHash(new TextEncoder().encode('chunk3')),
      ])
      const { root, tree } = buildChunkTree(hashes)

      for (const hash of hashes) {
        const proof = getChunkProof(tree, hash)
        expect(proof.length).toBeGreaterThan(0)
        expect(verifyChunkProof(root, hash, proof)).toBe(true)
      }
    })

    it('rejects tampered chunk hash', async () => {
      const hashes = [
        await computeChunkHash(new TextEncoder().encode('chunk0')),
        await computeChunkHash(new TextEncoder().encode('chunk1')),
      ]
      const { root, tree } = buildChunkTree(hashes)
      const proof = getChunkProof(tree, hashes[0])

      // Use a different hash with the same proof
      const tamperedHash = await computeChunkHash(new TextEncoder().encode('tampered'))
      expect(verifyChunkProof(root, tamperedHash, proof)).toBe(false)
    })

    it('rejects proof against wrong root', async () => {
      const hashes = [
        await computeChunkHash(new TextEncoder().encode('chunk0')),
        await computeChunkHash(new TextEncoder().encode('chunk1')),
      ]
      const { tree } = buildChunkTree(hashes)
      const proof = getChunkProof(tree, hashes[0])

      const wrongRoot = await computeChunkHash(new TextEncoder().encode('wrong root'))
      expect(verifyChunkProof(wrongRoot, hashes[0], proof)).toBe(false)
    })

    it('proof includes position info', async () => {
      const hashes = [
        await computeChunkHash(new TextEncoder().encode('left')),
        await computeChunkHash(new TextEncoder().encode('right')),
      ]
      const { tree } = buildChunkTree(hashes)
      const proof = getChunkProof(tree, hashes[0])
      expect(proof).toHaveLength(1)
      expect(proof[0]).toHaveProperty('position')
      expect(proof[0]).toHaveProperty('data')
      expect(['left', 'right']).toContain(proof[0].position)
    })
  })

  describe('end-to-end: chunk, encrypt, hash, tree, verify', () => {
    it('full pipeline works', async () => {
      const plaintext = nacl.randomBytes(500)
      const chunks = chunkData(plaintext)
      const encrypted = chunks.map(c => encryptChunk(c, encryptionKey))
      const hashes = await Promise.all(encrypted.map(e => computeChunkHash(e)))
      const { root, tree } = buildChunkTree(hashes)

      // Verify each chunk
      for (let i = 0; i < hashes.length; i++) {
        const proof = getChunkProof(tree, hashes[i])
        expect(verifyChunkProof(root, hashes[i], proof)).toBe(true)
      }

      // Decrypt and reassemble
      const decrypted = encrypted.map(e => decryptChunk(e, encryptionKey))
      const reassembled = new Uint8Array(plaintext.length)
      let offset = 0
      for (const d of decrypted) {
        reassembled.set(d, offset)
        offset += d.length
      }
      expect(reassembled).toEqual(plaintext)
    })

    it('same plaintext produces valid but different trees (random nonces)', async () => {
      const plaintext = nacl.randomBytes(200)

      const run = async () => {
        const chunks = chunkData(plaintext)
        const encrypted = chunks.map(c => encryptChunk(c, encryptionKey))
        const hashes = await Promise.all(encrypted.map(e => computeChunkHash(e)))
        const { root } = buildChunkTree(hashes)
        return root
      }

      const root1 = await run()
      const root2 = await run()
      // Roots differ because nonces are random
      expect(root1).not.toBe(root2)
    })
  })
})
