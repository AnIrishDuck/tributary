// Comprehensive validation test for the simplified hash process
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestServer, createTestClient, computeHash } from '../src/index';
import * as base64url from 'urlsafe-base64';
import nacl from 'tweetnacl';

describe('Hash Process Validation', () => {
  let testServer: any;
  let testKeyPair: nacl.SignKeyPair;
  let testPrivateKeyBase64: string;
  let testPublicKeyBase64: string;

  beforeEach(() => {
    testServer = createTestServer();
    testKeyPair = nacl.sign.keyPair();
    testPrivateKeyBase64 = base64url.encode(Buffer.from(testKeyPair.secretKey));
    testPublicKeyBase64 = base64url.encode(Buffer.from(testKeyPair.publicKey));
  });

  it('should validate the simplified hash process with manual verification', async () => {
    // Only run this test for FakeServer
    if (testServer.constructor.name !== 'FakeServer') {
      expect(true).toBe(true); // Skip test for real server
      return;
    }
    
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);

    // Execute a few operations
    await stream.query("CREATE TABLE test (id INTEGER, name TEXT)");
    await stream.query("INSERT INTO test VALUES (1, 'first')");
    await stream.query("INSERT INTO test VALUES (2, 'second')");

    // Get all blobs from the fake server
    const anyFakeServer = testServer as any;
    const blobs = Array.from(anyFakeServer.blobs.values());
    
    // Verify we have 3 blobs
    expect(blobs.length).toBe(3);
    
    // Sort blobs by sequence number
    blobs.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    // Manual verification of the hash process:
    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      
      // 1. Verify the prior hash chaining
      if (i === 0) {
        // First blob should have empty prior hash
        expect(blob.priorHash).toBe('');
      } else {
        // Subsequent blobs should reference the previous blob's hash
        expect(blob.priorHash).toBe(blobs[i-1].hash);
      }
      
      // 2. Verify hash structure (SHA256(priorHash + bodyHash))
      // Compute body hash manually
      const bodyHash = await computeHash(blob.data);
      const concatenated = `${blob.priorHash}${bodyHash}`;
      const expectedHash = await computeHash(new TextEncoder().encode(concatenated));
      expect(blob.hash).toBe(expectedHash);
      
      // 3. Verify signature validation
      const pubkeyBytes = base64url.decode(blob.pubkey);
      const signatureBytes = base64url.decode(blob.signature);
      const dataToSignBytes = new TextEncoder().encode(blob.hash);
      const isValid = nacl.sign.detached.verify(dataToSignBytes, signatureBytes, pubkeyBytes);
      expect(isValid).toBe(true);
      
      // 4. Verify sequence numbers are incremental
      expect(blob.sequenceNumber).toBe(i + 1);
    }
  });

  it('should demonstrate the simplified hash process step by step', async () => {
    // Only run this test for FakeServer
    if (testServer.constructor.name !== 'FakeServer') {
      expect(true).toBe(true); // Skip test for real server
      return;
    }
    
    // Step 1: Create a blob manually to understand the process
    const data = new TextEncoder().encode('Hello, Tributary!');
    const priorHash = ''; // First blob has empty prior hash
    
    // Step 2: Compute body hash
    const bodyHash = await computeHash(data);
    
    // Step 3: Compute the hash correctly (SHA256 of concatenated string)
    const concatenated = `${priorHash}${bodyHash}`;
    const hash = await computeHash(new TextEncoder().encode(concatenated));
    
    // Step 4: Create data to sign (just the hash)
    const dataToSignBytes = new TextEncoder().encode(hash);
    
    // Step 5: Sign the data
    const signatureBytes = nacl.sign.detached(dataToSignBytes, testKeyPair.secretKey);
    const signature = base64url.encode(Buffer.from(signatureBytes));
    
    // Step 6: Store the blob using FakeServer
    const result = await testServer.storeBlob(
      testPublicKeyBase64,
      data,
      hash,
      priorHash,
      signature,
      1
    );
    
    expect(result).toBe(true);
    
    // Step 7: Retrieve and verify
    const blobId = `${testPublicKeyBase64}:1`;
    const retrievedBlob = await testServer.retrieveBlob(testPublicKeyBase64, blobId);
    
    expect(retrievedBlob).not.toBeNull();
    expect(retrievedBlob!.hash).toBe(hash);
    expect(retrievedBlob!.priorHash).toBe(priorHash);
    expect(retrievedBlob!.sequenceNumber).toBe(1);
    
    // Step 8: Verify the signature using the same method as the server
    const pubkeyBytes = base64url.decode(retrievedBlob!.pubkey);
    const signatureBytesFromBlob = base64url.decode(retrievedBlob!.signature);
    const dataToSignBytesFromBlob = new TextEncoder().encode(retrievedBlob!.hash);
    const isValid = nacl.sign.detached.verify(dataToSignBytesFromBlob, signatureBytesFromBlob, pubkeyBytes);
    expect(isValid).toBe(true);
  });

  it('should validate hash chaining for multiple blobs', async () => {
    // Only run this test for FakeServer
    if (testServer.constructor.name !== 'FakeServer') {
      expect(true).toBe(true); // Skip test for real server
      return;
    }
    
    // Create first blob
    const data1 = new TextEncoder().encode('First blob');
    const priorHash1 = '';
    const bodyHash1 = await computeHash(data1);
    const concatenated1 = `${priorHash1}${bodyHash1}`;
    const hash1 = await computeHash(new TextEncoder().encode(concatenated1));
    const dataToSign1 = new TextEncoder().encode(hash1);
    const signature1 = base64url.encode(Buffer.from(nacl.sign.detached(dataToSign1, testKeyPair.secretKey)));
    
    await testServer.storeBlob(testPublicKeyBase64, data1, hash1, priorHash1, signature1, 1);
    
    // Create second blob (should chain from first)
    const data2 = new TextEncoder().encode('Second blob');
    const priorHash2 = hash1; // Chain from first blob
    const bodyHash2 = await computeHash(data2);
    const concatenated2 = `${priorHash2}${bodyHash2}`;
    const hash2 = await computeHash(new TextEncoder().encode(concatenated2));
    const dataToSign2 = new TextEncoder().encode(hash2);
    const signature2 = base64url.encode(Buffer.from(nacl.sign.detached(dataToSign2, testKeyPair.secretKey)));
    
    await testServer.storeBlob(testPublicKeyBase64, data2, hash2, priorHash2, signature2, 2);
    
    // Verify chaining
    const blobs = Array.from((testServer as any).blobs.values());
    expect(blobs.length).toBe(2);
    
    blobs.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    expect(blobs[0].priorHash).toBe('');
    expect(blobs[0].hash).toBe(hash1);
    expect(blobs[1].priorHash).toBe(hash1);
    expect(blobs[1].hash).toBe(hash2);
  });
});

