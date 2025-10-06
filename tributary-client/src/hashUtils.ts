/**
 * Compute SHA256 hash of data - matches the implementation in both client and server
 * @param data Data to hash
 * @returns Hex-encoded hash
 */
export async function computeHash(data: Uint8Array): Promise<string> {
  // Try to use Node.js crypto if available (matches client implementation)
  try {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(Buffer.from(data));
    const result = hash.digest('hex');
    return result;
  } catch (nodeCryptoError) {
    // Fallback to Web Crypto API (matches client implementation)
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const result = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return result;
      } catch (err: unknown) {
        throw new Error(`Failed to compute hash with both Node.js and Web Crypto: ${err}`);
      }
    } else {
      throw new Error('Neither Node.js nor Web Crypto API available - cannot compute hash.');
    }
  }
}
