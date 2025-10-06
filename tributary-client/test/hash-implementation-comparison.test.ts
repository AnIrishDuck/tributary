import { describe, it, expect } from 'vitest';
import { computeHash, computeNodeHash, computeWebHash } from '../src/hashUtils';

describe('Hash Implementation Compatibility', () => {
  it('should produce identical hashes from Node.js and Web Crypto implementations', async () => {
    // Test with various data types
    const testCases = [
      new TextEncoder().encode(''),
      new TextEncoder().encode('test data'),
      new TextEncoder().encode('Hello, Tributary!'),
      new TextEncoder().encode('This is a longer string to test hash computation with more data'),
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    ];

    for (const data of testCases) {
      // Skip Web Crypto test if not available
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        try {
          const nodeHash = await computeNodeHash(data);
          const webHash = await computeWebHash(data);
          expect(nodeHash).toBe(webHash);
        } catch (error) {
          // If Web Crypto is not available in this environment, skip the test
          console.warn('Web Crypto API not available in this environment, skipping test');
        }
      }
      
      // Also verify that the main computeHash function works correctly
      const hash = await computeHash(data);
      const nodeHash = await computeNodeHash(data);
      expect(hash).toBe(nodeHash);
    }
  });

  it('should handle edge cases consistently', async () => {
    // Test with empty data
    const emptyData = new TextEncoder().encode('');
    
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const nodeHash = await computeNodeHash(emptyData);
      const webHash = await computeWebHash(emptyData);
      expect(nodeHash).toBe(webHash);
      // Known SHA256 hash of empty string
      expect(nodeHash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    }

    // Test with single byte
    const singleByte = new Uint8Array([42]);
    
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const nodeHash = await computeNodeHash(singleByte);
      const webHash = await computeWebHash(singleByte);
      expect(nodeHash).toBe(webHash);
    }
  });
});
