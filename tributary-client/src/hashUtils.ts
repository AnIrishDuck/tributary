/**
 * Convert a Uint8Array hash to a hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute SHA256 hash of data using Node.js crypto
 * @param data Data to hash
 * @returns Hash as Uint8Array
 */
export async function computeNodeHashBytes(data: Uint8Array): Promise<Uint8Array> {
  const crypto = await import('node:crypto');
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  const hashBuffer = hash.digest();
  // Create a proper Uint8Array by copying the buffer, not sharing it
  // This ensures the result is a true Uint8Array, not a Buffer subclass
  return Uint8Array.from(hashBuffer);
}

/**
 * Compute SHA256 hash of data using Node.js crypto
 * @param data Data to hash
 * @returns Hex-encoded hash
 */
export async function computeNodeHash(data: Uint8Array): Promise<string> {
  return bytesToHex(await computeNodeHashBytes(data));
}

/**
 * Compute SHA256 hash of data using Web Crypto API
 * @param data Data to hash
 * @returns Hash as Uint8Array
 */
export async function computeWebHashBytes(data: Uint8Array): Promise<Uint8Array> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    // Convert Uint8Array to ArrayBuffer by creating a new Uint8Array
    const buffer = new Uint8Array(data).buffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return new Uint8Array(hashBuffer);
  } else {
    throw new Error('Web Crypto API not available');
  }
}

/**
 * Compute SHA256 hash of data using Web Crypto API
 * @param data Data to hash
 * @returns Hex-encoded hash
 */
export async function computeWebHash(data: Uint8Array): Promise<string> {
  return bytesToHex(await computeWebHashBytes(data));
}

/**
 * Compute SHA256 hash of data and return as Uint8Array.
 * Tries Node.js crypto first, falls back to Web Crypto API.
 * @param data Data to hash
 * @returns Hash as Uint8Array
 */
export async function computeHashBytes(data: Uint8Array): Promise<Uint8Array> {
  try {
    return await computeNodeHashBytes(data);
  } catch (nodeCryptoError) {
    // Fallback to Web Crypto API
    try {
      return await computeWebHashBytes(data);
    } catch (webCryptoError: unknown) {
      throw new Error(
        `Failed to compute hash with both Node.js crypto (${nodeCryptoError}) and Web Crypto (${webCryptoError})`
      );
    }
  }
}

/**
 * Compute SHA256 hash of data - matches the implementation in both client and server.
 * Tries Node.js crypto first, falls back to Web Crypto API.
 * @param data Data to hash
 * @returns Hex-encoded hash
 */
export async function computeHash(data: Uint8Array): Promise<string> {
  return bytesToHex(await computeHashBytes(data));
}
