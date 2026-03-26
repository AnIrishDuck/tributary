// Cryptographic operations for tributary-fn
// This module handles signature verification and hashing using Web Crypto API and tweetnacl

import nacl from 'tweetnacl';
import util from 'tweetnacl-util';
import { encodeBase64Url, decodeBase64Url } from 'jsr:@std/encoding';
import { computeHashPortable, verifyMerkleProof } from './merkleProof.ts';

// Re-export so existing consumers don't break
export { verifyMerkleProof } from './merkleProof.ts';

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
export const computeHash = computeHashPortable;

/**
 * Compute chain hash (SHA256(prior_hash + body_hash))
 * This matches the Rust implementation in tributary-server
 * @param priorHash Previous hash in the chain
 * @param bodyData Body data to hash
 * @returns Chain hash as hex string
 */
export async function computeChainHash(priorHash: string, bodyData: Uint8Array): Promise<string> {
  // Compute body hash first (same as client)
  const bodyHash = await computeHash(bodyData);

  // Concatenate prior_hash + body_hash, then hash the result (same as client does)
  const concatenated = new TextEncoder().encode(priorHash + bodyHash);
  return await computeHash(concatenated);
}
