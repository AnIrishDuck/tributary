import nacl from 'tweetnacl'
import { MerkleTree } from 'merkletreejs'
import SHA256 from 'crypto-js/sha256.js'
import { computeHash } from './hashUtils.js'

export const BLOB_CHUNK_SIZE = 6 * 1024 * 1024 // 6MB

/**
 * Split data into chunks of at most BLOB_CHUNK_SIZE bytes.
 * Returns at least one chunk (empty Uint8Array for empty input).
 */
export function chunkData(data: Uint8Array): Uint8Array[] {
  if (data.length === 0) {
    return [new Uint8Array(0)]
  }
  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < data.length; offset += BLOB_CHUNK_SIZE) {
    chunks.push(data.slice(offset, offset + BLOB_CHUNK_SIZE))
  }
  return chunks
}

/**
 * Encrypt a chunk using nacl.secretbox with a random nonce.
 * Returns nonce (24 bytes) || ciphertext.
 */
export function encryptChunk(chunk: Uint8Array, encryptionKey: Uint8Array): Uint8Array {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
  const ciphertext = nacl.secretbox(chunk, nonce, encryptionKey)
  const result = new Uint8Array(nonce.length + ciphertext.length)
  result.set(nonce)
  result.set(ciphertext, nonce.length)
  return result
}

/**
 * Decrypt a chunk encrypted with encryptChunk.
 * Expects nonce (24 bytes) || ciphertext.
 */
export function decryptChunk(encrypted: Uint8Array, encryptionKey: Uint8Array): Uint8Array {
  const nonce = encrypted.slice(0, nacl.secretbox.nonceLength)
  const ciphertext = encrypted.slice(nacl.secretbox.nonceLength)
  const plaintext = nacl.secretbox.open(ciphertext, nonce, encryptionKey)
  if (plaintext === null) {
    throw new Error('Failed to decrypt chunk (wrong key or corrupted data)')
  }
  return plaintext
}

/**
 * Compute SHA256 hash of a chunk, returning hex string.
 */
export async function computeChunkHash(chunk: Uint8Array): Promise<string> {
  return computeHash(chunk)
}

/**
 * Build a merkle tree from chunk hashes.
 * Returns the root hash (hex) and the MerkleTree instance.
 */
export function buildChunkTree(chunkHashes: string[]): { root: string; tree: MerkleTree } {
  const leaves = chunkHashes.map(h => Buffer.from(h, 'hex'))
  const tree = new MerkleTree(leaves, SHA256)
  const root = tree.getRoot().toString('hex')
  return { root, tree }
}

export interface ProofEntry {
  position: 'left' | 'right'
  data: string // hex-encoded hash
}

/**
 * Get the merkle proof for a chunk hash.
 * Returns array of { position, data } entries needed for verification.
 */
export function getChunkProof(tree: MerkleTree, chunkHash: string): ProofEntry[] {
  const leaf = Buffer.from(chunkHash, 'hex')
  const proof = tree.getProof(leaf)
  return proof.map((p: { position: string; data: Buffer }) => ({
    position: p.position as 'left' | 'right',
    data: p.data.toString('hex'),
  }))
}

/**
 * Verify that a chunk hash belongs to a merkle tree with the given root.
 */
export function verifyChunkProof(root: string, chunkHash: string, proof: ProofEntry[]): boolean {
  const leaf = Buffer.from(chunkHash, 'hex')
  const rootBuf = Buffer.from(root, 'hex')
  const tree = new MerkleTree([], SHA256)
  const proofObjects = proof.map(p => ({
    position: p.position,
    data: Buffer.from(p.data, 'hex'),
  }))
  return tree.verify(proofObjects, leaf, rootBuf)
}
