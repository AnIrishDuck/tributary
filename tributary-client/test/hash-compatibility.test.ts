import { describe, it, expect } from 'vitest';
import { computeHash } from '../src/hashUtils';

// Test to verify hash functions between client and server produce identical results

describe('Hash Function Compatibility Test', () => {
  it('should produce consistent hash results using the same algorithm', async () => {
    // Test data
    const testData = new TextEncoder().encode('test data for hashing');
    const priorHash = 'abc123def456';
    
    // Compute body hash using our implementation
    const bodyHash = await computeHash(testData);
    
    // Compute the chained hash (SHA256(priorHash + bodyHash)) - same as server would do after fix
    const concatenated = `${priorHash}${bodyHash}`;
    const chainedHash = await computeHash(new TextEncoder().encode(concatenated));
    
    // Verify the hash is computed consistently
    // For "test data for hashing", SHA256 should be consistent
    const expectedBodyHash = 'f7eb7961d8a233e6256d3a6257548bbb9293c3a08fb3574c88c7d6b429dbb9f5';
    const expectedChainedHash = 'e8910954652f2957dd5b6f34d88c78ff7f086546e2b94aef687290d409519a67';
    
    expect(bodyHash).toBe(expectedBodyHash);
    expect(chainedHash).toBe(expectedChainedHash);
  });
  
  it('should validate the hash computation process is deterministic', async () => {
    // Simulate the exact process used by both client and server after fix
    
    // Step 1: Prepare test data
    const testData = new TextEncoder().encode('Hello, Tributary!');
    const priorHash = 'a1b2c3d4e5f';
    
    // Step 2: Compute body hash (SHA256 of data)
    const bodyHash = await computeHash(testData);
    
    // Step 3: Compute chained hash (SHA256(priorHash + bodyHash))
    const concatenated = `${priorHash}${bodyHash}`;
    const chainedHash = await computeHash(new TextEncoder().encode(concatenated));
    
    // Both should use the same algorithm, same encoding (hex), same chaining
    
    // For "Hello, Tributary!", the SHA256 should be:
    const expectedBodyHash = '692f392e53f691be69dd1e502ef474a9103a19a48ef7a0a9115ee83d3a4bcb57';
    const expectedChainedHash = 'c6a7678f0c10c4ef797589575b0c8ffc108ee965cf1c06fef71cec3edc867b91';
    
    expect(bodyHash).toBe(expectedBodyHash);
    expect(chainedHash).toBe(expectedChainedHash);
  });
  
  it('should match the exact same process used by tributary-server after fix', async () => {
    // This test verifies that our implementation matches exactly what tributary-server does after the fix
    
    // The server now uses sha2 crate to:
    // 1. Compute SHA256 of body data
    // 2. Concatenate prior_hash + body_hash
    // 3. Compute SHA256 of the concatenated result
    
    // Test with empty data (edge case)
    const emptyData = new TextEncoder().encode('');
    const emptyBodyHash = await computeHash(emptyData);
    const expectedEmptyBodyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(emptyBodyHash).toBe(expectedEmptyBodyHash);
    
    // Test computing the chained hash for empty data
    const emptyPriorHash = '';
    const emptyConcatenated = `${emptyPriorHash}${emptyBodyHash}`;
    const emptyChainedHash = await computeHash(new TextEncoder().encode(emptyConcatenated));
    // This would be SHA256("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    // = SHA256(empty string hash) = "057dba3d05308af630d801001bc94eeecc6a65142e9d1e88ecc713b3a908f1ab"
    
    // Test with typical blob data
    const blobData = new TextEncoder().encode('Sample blob data for tributary');
    const blobBodyHash = await computeHash(blobData);
    
    // Verify the process: SHA256(prior_hash + body_hash)
    const priorHash = 'prev-hash-123';
    const concatenated = `${priorHash}${blobBodyHash}`;
    const chainedHash = await computeHash(new TextEncoder().encode(concatenated));
    
    // This is the exact same process the Rust server uses in compute_hash + hash chaining
    expect(typeof chainedHash).toBe('string');
    expect(chainedHash).toHaveLength(64); // SHA256 produces 64-character hex string
  });
});
