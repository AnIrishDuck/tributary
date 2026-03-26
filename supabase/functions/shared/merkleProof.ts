// Merkle proof verification — portable (no Deno-specific imports).
// Used by the edge function (via crypto.ts re-export) and by
// cross-implementation compatibility tests in tributary-client.

/**
 * Compute SHA-256 hash of data using Web Crypto API.
 * @returns Hex-encoded hash string
 */
export async function computeHashPortable(data: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(data).buffer;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

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
    let hash = chunkHash;

    for (const step of proof) {
      const left = step.position === 'left' ? step.data : hash;
      const right = step.position === 'left' ? hash : step.data;

      const leftBuf = hexToBytes(left);
      const rightBuf = hexToBytes(right);
      const combined = new Uint8Array(leftBuf.length + rightBuf.length);
      combined.set(leftBuf);
      combined.set(rightBuf, leftBuf.length);

      hash = await computeHashPortable(combined);
    }

    return hash === rootHash;
  } catch (error) {
    console.error('Merkle proof verification error:', error);
    return false;
  }
}
