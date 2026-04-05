/**
 * SHA-256 hashing utilities with Node.js crypto and Web Crypto API backends.
 *
 * Each backend has a single internal helper that returns raw bytes; the public
 * hex/bytes variants are thin wrappers around those helpers.
 */

/** Convert a Uint8Array to a lowercase hex string. */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// Node.js crypto backend
// ---------------------------------------------------------------------------

/** Compute SHA-256 using Node.js crypto, returning raw bytes. */
async function nodeHashRaw(data: Uint8Array): Promise<Uint8Array> {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256');
  hash.update(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  // Return a true Uint8Array (not a Buffer subclass) by copying the digest.
  return Uint8Array.from(hash.digest());
}

/**
 * Compute SHA256 hash of data using Node.js crypto
 * @param data Data to hash
 * @returns Hex-encoded hash
 */
export async function computeNodeHash(data: Uint8Array): Promise<string> {
  return bytesToHex(await nodeHashRaw(data));
}

/**
 * Compute SHA256 hash of data using Node.js crypto
 * @param data Data to hash
 * @returns Hash as Uint8Array
 */
export async function computeNodeHashBytes(
  data: Uint8Array,
): Promise<Uint8Array> {
  return nodeHashRaw(data);
}

// ---------------------------------------------------------------------------
// Web Crypto API backend
// ---------------------------------------------------------------------------

/** Compute SHA-256 using the Web Crypto API, returning raw bytes. */
async function webHashRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buffer = new Uint8Array(data).buffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return new Uint8Array(hashBuffer);
  }
  throw new Error('Web Crypto API not available');
}

/**
 * Compute SHA256 hash of data using Web Crypto API
 * @param data Data to hash
 * @returns Hex-encoded hash
 */
export async function computeWebHash(data: Uint8Array): Promise<string> {
  return bytesToHex(await webHashRaw(data));
}

/**
 * Compute SHA256 hash of data using Web Crypto API
 * @param data Data to hash
 * @returns Hash as Uint8Array
 */
export async function computeWebHashBytes(
  data: Uint8Array,
): Promise<Uint8Array> {
  return webHashRaw(data);
}

// ---------------------------------------------------------------------------
// Auto-detecting helpers (try Node first, then Web Crypto)
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 using whichever backend is available, returning raw bytes.
 * Tries Node.js crypto first, then falls back to the Web Crypto API.
 */
async function computeHashRaw(data: Uint8Array): Promise<Uint8Array> {
  try {
    return await nodeHashRaw(data);
  } catch {
    try {
      return await webHashRaw(data);
    } catch (err: unknown) {
      throw new Error(
        `Failed to compute hash with both Node.js and Web Crypto: ${err}`,
      );
    }
  }
}

/**
 * Compute SHA256 hash of data - matches the implementation in both client and server
 * @param data Data to hash
 * @returns Hex-encoded hash
 */
export async function computeHash(data: Uint8Array): Promise<string> {
  return bytesToHex(await computeHashRaw(data));
}

/**
 * Compute SHA256 hash of data and return as Uint8Array
 * @param data Data to hash
 * @returns Hash as Uint8Array
 */
export async function computeHashBytes(
  data: Uint8Array,
): Promise<Uint8Array> {
  return computeHashRaw(data);
}
