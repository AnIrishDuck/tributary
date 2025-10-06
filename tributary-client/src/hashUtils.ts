/**
 * Compute SHA256 hash of data using Node.js crypto
 * @param data Data to hash
 * @returns Hex-encoded hash
 */
export async function computeNodeHash(data: Uint8Array): Promise<string> {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from(data));
  return hash.digest('hex');
}

/**
 * Compute SHA256 hash of data using Web Crypto API
 * @param data Data to hash
 * @returns Hex-encoded hash
 */
export async function computeWebHash(data: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    throw new Error('Web Crypto API not available');
  }
}

/**
 * Compute SHA256 hash of data - matches the implementation in both client and server
 * @param data Data to hash
 * @returns Hex-encoded hash
 */
export async function computeHash(data: Uint8Array): Promise<string> {
  // Try to use Node.js crypto if available (matches client implementation)
  try {
    return await computeNodeHash(data);
  } catch (nodeCryptoError) {
    // Fallback to Web Crypto API (matches client implementation)
    try {
      return await computeWebHash(data);
    } catch (err: unknown) {
      throw new Error(`Failed to compute hash with both Node.js and Web Crypto: ${err}`);
    }
  }
}
