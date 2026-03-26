import nacl from 'tweetnacl'
import { computeHashBytes } from './hashUtils.js'
import {
  BLOB_CHUNK_SIZE,
  chunkData,
  encryptChunk,
  decryptChunk,
  computeChunkHash,
  buildChunkTree,
  getChunkProof,
} from './blobHelpers.js'
import type { Server, ObjectBlobMetadata } from './server.js'

/** Size of an encrypted chunk for a full plaintext chunk */
const ENCRYPTED_CHUNK_SIZE =
  BLOB_CHUNK_SIZE + nacl.secretbox.nonceLength + nacl.secretbox.overheadLength

export class TributaryBlob {
  private server: Server
  private readKey: Uint8Array

  /**
   * Create a TributaryBlob instance for uploading/downloading blobs
   * encrypted with the given stream's read key.
   *
   * @param server - Server interface for blob storage
   * @param readKey - Uint8Array read key (stream's private key first 32 bytes),
   *                  used to derive the nacl.secretbox encryption key.
   *                  Same derivation as TributaryStream: SHA256(readKey) → 32 bytes.
   */
  constructor(server: Server, readKey: Uint8Array) {
    this.server = server
    this.readKey = readKey
  }

  /**
   * Derive a symmetric encryption key from the read key.
   * Same derivation as TributaryStream: SHA256(readKey[0:32])[0:32].
   */
  private async deriveEncryptionKey(): Promise<Uint8Array> {
    const keySlice = new Uint8Array(this.readKey.slice(0, 32))
    const hashBytes = await computeHashBytes(keySlice)
    return new Uint8Array(hashBytes.slice(0, nacl.secretbox.keyLength))
  }

  /**
   * Encrypt and upload a blob. Returns the root hash (content address).
   *
   * Flow:
   * 1. Chunk the plaintext data into 6MB pieces
   * 2. Encrypt each chunk (nacl.secretbox with random nonce)
   * 3. Hash each encrypted chunk → leaf hashes
   * 4. Build merkle tree from leaf hashes → root hash
   * 5. Call server.initBlobUpload(rootHash, { chunkCount, totalSize, domain })
   * 6. For each chunk in order: get merkle proof,
   *    call server.uploadBlobChunk(rootHash, index, encryptedChunk, proof)
   * 7. Return root hash
   */
  async upload(data: Uint8Array, domain?: string): Promise<string> {
    const encryptionKey = await this.deriveEncryptionKey()

    // 1. Chunk
    const chunks = chunkData(data)

    // 2. Encrypt each chunk
    const encryptedChunks = chunks.map(c => encryptChunk(c, encryptionKey))

    // 3. Hash each encrypted chunk
    const chunkHashes = await Promise.all(
      encryptedChunks.map(ec => computeChunkHash(ec))
    )

    // 4. Build merkle tree
    const { root, tree } = buildChunkTree(chunkHashes)

    // 5. Compute total encrypted size
    let totalSize = 0
    for (const ec of encryptedChunks) totalSize += ec.length

    // 6. Init upload
    await this.server.initBlobUpload(root, {
      chunkCount: encryptedChunks.length,
      totalSize,
      domain: domain || '',
    })

    // 7. Upload each chunk with proof
    for (let i = 0; i < encryptedChunks.length; i++) {
      const proof = getChunkProof(tree, chunkHashes[i])
      await this.server.uploadBlobChunk(root, i, encryptedChunks[i], proof)
    }

    return root
  }

  /**
   * Download and decrypt a blob by root hash.
   * Downloads the full encrypted blob, splits into encrypted chunks
   * (using known chunk size), decrypts each, reassembles.
   * Throws if decryption fails.
   */
  async download(rootHash: string): Promise<Uint8Array> {
    const encryptionKey = await this.deriveEncryptionKey()

    const blobData = await this.server.downloadBlob(rootHash)
    if (blobData === null) {
      throw new Error(`Blob not found: ${rootHash}`)
    }

    // Split into encrypted chunks
    const encryptedChunks: Uint8Array[] = []
    let offset = 0
    while (offset < blobData.length) {
      const end = Math.min(offset + ENCRYPTED_CHUNK_SIZE, blobData.length)
      encryptedChunks.push(blobData.slice(offset, end))
      offset = end
    }

    // Decrypt each chunk
    const plainChunks = encryptedChunks.map(ec => decryptChunk(ec, encryptionKey))

    // Reassemble
    let totalSize = 0
    for (const pc of plainChunks) totalSize += pc.length

    const result = new Uint8Array(totalSize)
    offset = 0
    for (const pc of plainChunks) {
      result.set(pc, offset)
      offset += pc.length
    }

    return result
  }

  /**
   * Get metadata for a blob (size, domain, created date).
   */
  async getMetadata(rootHash: string): Promise<ObjectBlobMetadata | null> {
    return this.server.getBlobObjectMetadata(rootHash)
  }
}
