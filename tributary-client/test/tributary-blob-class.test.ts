import { describe, it, expect } from 'vitest'
import nacl from 'tweetnacl'
import { TributaryBlob } from '../src/tributaryBlob.js'
import { FakeServer } from '../src/fakeServer.js'
import { BLOB_CHUNK_SIZE, deriveEncryptionKey } from '../src/blobHelpers.js'

describe('TributaryBlob', () => {
  const readKey = nacl.randomBytes(64) // simulate a stream private key

  function setup() {
    const server = new FakeServer()
    const blob = new TributaryBlob(server, readKey)
    return { server, blob }
  }

  describe('upload + download round-trip', () => {
    it('single-chunk blob', async () => {
      const { blob } = setup()
      const data = new TextEncoder().encode('hello blob world')
      const rootHash = await blob.upload(data, 'test-domain')

      expect(rootHash).toMatch(/^[0-9a-f]+$/)

      const downloaded = await blob.download(rootHash)
      expect(downloaded).toEqual(data)
    })

    it('multi-chunk blob', async () => {
      const { blob } = setup()
      // Create data spanning 3 chunks: 2 full + partial
      const size = BLOB_CHUNK_SIZE * 2 + 1000
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) data[i] = i % 256

      const rootHash = await blob.upload(data, 'test-domain')
      const downloaded = await blob.download(rootHash)
      expect(downloaded).toEqual(data)
    })

    it('empty data', async () => {
      const { blob } = setup()
      const data = new Uint8Array(0)
      const rootHash = await blob.upload(data, 'test-domain')
      const downloaded = await blob.download(rootHash)
      expect(downloaded).toEqual(data)
    })

    it('data exactly at chunk boundary', async () => {
      const { blob } = setup()
      const data = new Uint8Array(BLOB_CHUNK_SIZE)
      for (let i = 0; i < data.length; i++) data[i] = i % 256

      const rootHash = await blob.upload(data, 'test-domain')
      const downloaded = await blob.download(rootHash)
      expect(downloaded).toEqual(data)
    })

    it('data exactly at two chunk boundaries', async () => {
      const { blob } = setup()
      const data = new Uint8Array(BLOB_CHUNK_SIZE * 2)
      for (let i = 0; i < data.length; i++) data[i] = i % 256

      const rootHash = await blob.upload(data, 'test-domain')
      const downloaded = await blob.download(rootHash)
      expect(downloaded).toEqual(data)
    })
  })

  describe('encryption', () => {
    it('same plaintext + same key produces different root hashes (random nonces)', async () => {
      const { blob } = setup()
      const data = nacl.randomBytes(500)

      const root1 = await blob.upload(data, 'domain-a')
      // Need a fresh server since same rootHash can't be uploaded twice
      const server2 = new FakeServer()
      const blob2 = new TributaryBlob(server2, readKey)
      const root2 = await blob2.upload(data, 'domain-b')

      expect(root1).not.toBe(root2)
    })

    it('download with wrong read key fails decryption', async () => {
      const { server, blob } = setup()
      const data = new TextEncoder().encode('secret content')
      const rootHash = await blob.upload(data, 'test-domain')

      const wrongKey = nacl.randomBytes(64)
      const wrongBlob = new TributaryBlob(server, wrongKey)
      await expect(wrongBlob.download(rootHash)).rejects.toThrow('Failed to decrypt chunk')
    })
  })

  describe('FakeServer verification', () => {
    it('rejects chunk with bad merkle proof', async () => {
      const server = new FakeServer()

      // Manually set up an upload to test proof rejection
      await server.initBlobUpload('fakeroothash', {
        chunkCount: 1,
        totalSize: 100,
        domain: 'test',
      })

      const chunkData = nacl.randomBytes(100)
      // Provide an empty proof with a root hash that won't match
      await expect(
        server.uploadBlobChunk('fakeroothash', 0, chunkData, [])
      ).rejects.toThrow('Merkle proof verification failed')
    })

    it('rejects chunk with wrong data (hash mismatch)', async () => {
      const server = new FakeServer()

      // Build a real tree from specific data
      const { computeChunkHash, buildChunkTree, getChunkProof, encryptChunk } = await import('../src/blobHelpers.js')
      const encKey = await deriveEncryptionKey(readKey)

      const chunk = new TextEncoder().encode('real chunk data')
      const encrypted = encryptChunk(chunk, encKey)
      const hash = await computeChunkHash(encrypted)
      const { root, tree } = buildChunkTree([hash])
      const proof = getChunkProof(tree, hash)

      await server.initBlobUpload(root, {
        chunkCount: 1,
        totalSize: encrypted.length,
        domain: 'test',
      })

      // Upload different data with the proof for the original data
      const wrongData = new TextEncoder().encode('WRONG chunk data that is different')
      await expect(
        server.uploadBlobChunk(root, 0, wrongData, proof)
      ).rejects.toThrow('Merkle proof verification failed')
    })
  })

  describe('metadata', () => {
    it('returns correct info after upload', async () => {
      const { blob } = setup()
      const data = nacl.randomBytes(1500)
      const rootHash = await blob.upload(data, 'my-domain')

      const metadata = await blob.getMetadata(rootHash)
      expect(metadata).not.toBeNull()
      expect(metadata!.rootHash).toBe(rootHash)
      expect(metadata!.domain).toBe('my-domain')
      expect(metadata!.chunkCount).toBe(1)
      expect(metadata!.size).toBeGreaterThan(data.length) // encrypted > plaintext
      expect(metadata!.createdAt).toBeInstanceOf(Date)
    })

    it('returns null for non-existent blob', async () => {
      const { blob } = setup()
      const metadata = await blob.getMetadata('nonexistenthash')
      expect(metadata).toBeNull()
    })

    it('returns correct chunk count for multi-chunk blob', async () => {
      const { blob } = setup()
      const size = BLOB_CHUNK_SIZE * 2 + 100
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) data[i] = i % 256

      const rootHash = await blob.upload(data, 'multi-domain')
      const metadata = await blob.getMetadata(rootHash)
      expect(metadata).not.toBeNull()
      expect(metadata!.chunkCount).toBe(3)
    })
  })

  describe('download errors', () => {
    it('throws for non-existent blob', async () => {
      const { blob } = setup()
      await expect(blob.download('nonexistenthash')).rejects.toThrow('Blob not found')
    })
  })
})
