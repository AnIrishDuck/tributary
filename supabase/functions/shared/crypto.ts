// Cryptographic operations for tributary-fn
// This module handles signature verification and hashing using Web Crypto API and tweetnacl

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { encodeBase64Url, decodeBase64Url } from 'jsr:@std/encoding';

/**
 * Decode URL-safe base64 string using Deno std/encoding library
 * @param encoded URL-safe base64 encoded string
 * @returns Decoded Uint8Array
 */
export function decodeUrlBase64(encoded: string): Uint8Array {
  return decodeBase64Url(encoded);
}

/**
 * Encode Uint8Array to URL-safe base64 string using Deno std/encoding library
 * @param data Data to encode
 * @returns URL-safe base64 encoded string
 */
export function encodeUrlBase64(data: Uint8Array): string {
  return encodeBase64Url(data);
}

export async function verifySignature(
  pubkey: string,
  signature: string,
  data: Uint8Array
): Promise<boolean> {
  try {
    // Always decode the public key and signature using URL-safe base64
    const publicKeyBytes = decodeUrlBase64(pubkey);
    const signatureBytes = decodeUrlBase64(signature);

    // Verify the signature
    return nacl.sign.detached.verify(data, signatureBytes, publicKeyBytes);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Compute SHA-256 hash of data
 * @param data Input data
 * @returns Hex encoded hash
 */
export async function computeHash(data: Uint8Array): Promise<string> {
  // Create a new ArrayBuffer from the Uint8Array to avoid type issues
  const buffer = new Uint8Array(data).buffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute chain hash (SHA256(prior_hash + body_hash))
 * This matches the Rust implementation in tributary-server
 * @param priorHash Previous hash in the chain
 * @param bodyData Body data to hash
 * @returns Chain hash as hex string
 */
/**
 * Verify a merkle proof: that a chunk hash belongs to a tree with the given root.
 * Uses the same SHA256 algorithm as merkletreejs.
 */
export async function verifyMerkleProof(
  rootHash: string,
  chunkHash: string,
  proof: Array<{ position: 'left' | 'right'; data: string }>,
): Promise<boolean> {
  try {
    // Start with the leaf hash
    let hash = chunkHash;

    for (const step of proof) {
      // Combine current hash with proof sibling in the correct order
      const left = step.position === 'left' ? step.data : hash;
      const right = step.position === 'left' ? hash : step.data;

      // merkletreejs concatenates the raw buffers and hashes
      const leftBuf = hexToBytes(left);
      const rightBuf = hexToBytes(right);
      const combined = new Uint8Array(leftBuf.length + rightBuf.length);
      combined.set(leftBuf);
      combined.set(rightBuf, leftBuf.length);

      hash = await computeHash(combined);
    }

    return hash === rootHash;
  } catch (error) {
    console.error('Merkle proof verification error:', error);
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function computeChainHash(priorHash: string, bodyData: Uint8Array): Promise<string> {
  // Compute body hash first (same as client)
  const bodyHash = await computeHash(bodyData);

  // Concatenate prior_hash + body_hash, then hash the result (same as client does)
  const concatenated = new TextEncoder().encode(priorHash + bodyHash);
  return await computeHash(concatenated);
}
