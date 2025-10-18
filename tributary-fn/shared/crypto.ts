// Cryptographic operations for tributary-fn
// This module handles signature verification and hashing using Web Crypto API and tweetnacl

import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64 } from 'tweetnacl-util';

/**
 * Verify an Ed25519 signature
 * @param pubkey Base64 encoded public key
 * @param signature Base64 encoded signature
 * @param data Data that was signed
 * @returns Boolean indicating if signature is valid
 */
export async function verifySignature(
  pubkey: string,
  signature: string,
  data: Uint8Array
): Promise<boolean> {
  try {
    // Decode the public key from base64 (try URL_SAFE first, then STANDARD)
    let publicKeyBytes: Uint8Array;
    try {
      publicKeyBytes = decodeBase64(pubkey);
    } catch {
      // If URL_SAFE fails, try STANDARD
      publicKeyBytes = decodeBase64(pubkey);
    }

    // Decode the signature from base64 (try URL_SAFE first, then STANDARD)
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = decodeBase64(signature);
    } catch {
      // If URL_SAFE fails, try STANDARD
      signatureBytes = decodeBase64(signature);
    }

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
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
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
export async function computeChainHash(priorHash: string, bodyData: Uint8Array): Promise<string> {
  // Compute body hash first (same as client)
  const bodyHash = await computeHash(bodyData);

  // Concatenate prior_hash + body_hash, then hash the result (same as client does)
  const concatenated = new TextEncoder().encode(priorHash + bodyHash);
  return await computeHash(concatenated);
}
