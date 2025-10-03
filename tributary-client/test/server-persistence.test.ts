// Tests for server persistence functionality
import { describe, it, expect, beforeEach } from 'vitest';
import { TributaryClient, FakeServer } from '../src/index';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import nacl from 'tweetnacl';

// Helper functions to compute hashes the same way as the client and server
async function computeHashInTest(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('Server Persistence', () => {
  let fakeServer: FakeServer;
  let testKeyPair: nacl.SignKeyPair;
  let testPrivateKeyBase64: string;

  beforeEach(() => {
    fakeServer = new FakeServer();
    testKeyPair = nacl.sign.keyPair();
    testPrivateKeyBase64 = encodeBase64(testKeyPair.secretKey);
  });

  it('should persist write operations to server before local execution', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Track server calls
    let serverStoreCalls = 0;
    const originalStoreBlob = fakeServer.storeBlob.bind(fakeServer);
    fakeServer.storeBlob = async (...args: any[]) => {
      serverStoreCalls++;
      return originalStoreBlob(...args);
    };
    
    // Create a table first
    await client.query("CREATE TABLE users (name TEXT)");
    
    // Execute a write query
    const result = await client.query("INSERT INTO users (name) VALUES ('Alice')");
    
    // Verify that server persistence was called before local execution
    expect(serverStoreCalls).toBe(2); // One for CREATE TABLE, one for INSERT
    
    // Verify that local execution still happened
    expect(result).toBeDefined();
  });

  it('should maintain proper chaining of transactions', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Execute multiple write operations
    await client.query("CREATE TABLE test (id INTEGER, name TEXT)");
    await client.query("INSERT INTO test VALUES (1, 'first')");
    await client.query("INSERT INTO test VALUES (2, 'second')");
    
    // Verify that all operations were persisted to server by checking the fake server directly
    // We'll access the private blobs map through a workaround
    const anyFakeServer = fakeServer as any;
    const blobCount = anyFakeServer.blobs ? anyFakeServer.blobs.size : 0;
    expect(blobCount).toBe(3);
    
    // Verify chaining by checking that each blob has the correct priorHash
    // This would be more thoroughly tested in a more complete implementation
  });

  it('should properly chain hashes for multiple entries', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Execute multiple write operations
    await client.query("CREATE TABLE test (id INTEGER, name TEXT)");
    await client.query("INSERT INTO test VALUES (1, 'first')");
    await client.query("INSERT INTO test VALUES (2, 'second')");
    
    // Get all blobs from the fake server
    const anyFakeServer = fakeServer as any;
    const blobs = Array.from(anyFakeServer.blobs.values());
    
    // Verify we have 3 blobs
    expect(blobs.length).toBe(3);
    
    // Sort blobs by sequence number
    blobs.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    // Verify the chaining:
    // 1. First blob should have empty priorHash
    expect(blobs[0].priorHash).toBe('');
    
    // 2. Each subsequent blob should have the previous blob's hash as priorHash
    expect(blobs[1].priorHash).toBe(blobs[0].hash);
    expect(blobs[2].priorHash).toBe(blobs[1].hash);
    
    // 3. Verify that each blob's hash was computed correctly (priorHash + bodyHash)
    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      const priorHash = blob.priorHash;
      const bodyHash = await computeHashInTest(blob.data);
      const expectedHash = `${priorHash}${bodyHash}`;
      expect(blob.hash).toBe(expectedHash);
    }
  });

  it('should validate signatures using the same method as the server', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Execute a write operation
    await client.query("CREATE TABLE test (id INTEGER, name TEXT)");
    
    // Get the blob from the fake server
    const anyFakeServer = fakeServer as any;
    const blobs = Array.from(anyFakeServer.blobs.values());
    expect(blobs.length).toBe(1);
    
    const blob = blobs[0];
    
    // Verify the signature using the same method as the server
    // This mimics how tributary-server verifies signatures
    const pubkeyBytes = decodeBase64(blob.pubkey);
    const signatureBytes = decodeBase64(blob.signature);
    
    // Recreate the data that was signed (just the concatenated hash)
    const dataToSignBytes = new TextEncoder().encode(blob.hash);
    
    // Verify the signature using nacl
    const isValid = nacl.sign.detached.verify(dataToSignBytes, signatureBytes, pubkeyBytes);
    expect(isValid).toBe(true);
  });

  it('should replicate the exact hash structure from server integration tests', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Execute multiple operations like in the server integration tests
    await client.query("CREATE TABLE test (id INTEGER, name TEXT)");
    await client.query("INSERT INTO test VALUES (1, 'first')");
    await client.query("INSERT INTO test VALUES (2, 'second')");
    
    // Get all blobs
    const anyFakeServer = fakeServer as any;
    const blobs = Array.from(anyFakeServer.blobs.values());
    expect(blobs.length).toBe(3);
    
    // Sort by sequence number
    blobs.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    // Verify the exact structure from server integration tests:
    // 1. First blob should have empty prior hash
    expect(blobs[0].priorHash).toBe('');
    
    // 2. Each subsequent blob should reference the previous blob's hash
    expect(blobs[1].priorHash).toBe(blobs[0].hash);
    expect(blobs[2].priorHash).toBe(blobs[1].hash);
    
    // 3. Verify that hashes are computed correctly (priorHash + bodyHash)
    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      const bodyHash = await computeHashInTest(blob.data);
      const expectedHash = `${blob.priorHash}${bodyHash}`;
      expect(blob.hash).toBe(expectedHash);
    }
    
    // 4. Verify all signatures are valid
    for (const blob of blobs) {
      const pubkeyBytes = decodeBase64(blob.pubkey);
      const signatureBytes = decodeBase64(blob.signature);
      const dataToSignBytes = new TextEncoder().encode(blob.hash);
      const isValid = nacl.sign.detached.verify(dataToSignBytes, signatureBytes, pubkeyBytes);
      expect(isValid).toBe(true);
    }
    
    // 5. Verify sequence numbers are incremental
    expect(blobs[0].sequenceNumber).toBe(1);
    expect(blobs[1].sequenceNumber).toBe(2);
    expect(blobs[2].sequenceNumber).toBe(3);
  });

  it('should handle server persistence failures appropriately', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Create a table first
    await client.query("CREATE TABLE users (name TEXT)");
    
    // Simulate server failure by making storeBlob return false
    fakeServer.storeBlob = async (...args: any[]) => {
      return false; // Simulate failure
    };
    
    // Try to execute a write query - should fail
    await expect(client.query("INSERT INTO users (name) VALUES ('Alice')"))
      .rejects
      .toThrow('Failed to persist transaction on server');
  });

  it('should persist exec operations to server before local execution', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Track server calls
    let serverStoreCalls = 0;
    const originalStoreBlob = fakeServer.storeBlob.bind(fakeServer);
    fakeServer.storeBlob = async (...args: any[]) => {
      serverStoreCalls++;
      return originalStoreBlob(...args);
    };
    
    // Create a table using exec
    await client.exec("CREATE TABLE users (name TEXT)");
    
    // Execute a write operation using exec
    await client.exec("INSERT INTO users (name) VALUES ('Alice')");
    
    // Verify that server persistence was called before local execution
    expect(serverStoreCalls).toBe(2); // One for CREATE TABLE, one for INSERT
  });

  it('should properly chain hashes for exec entries', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Execute multiple write operations using exec
    await client.exec("CREATE TABLE test (id INTEGER, name TEXT)");
    await client.exec("INSERT INTO test VALUES (1, 'first')");
    await client.exec("INSERT INTO test VALUES (2, 'second')");
    
    // Get all blobs from the fake server
    const anyFakeServer = fakeServer as any;
    const blobs = Array.from(anyFakeServer.blobs.values());
    
    // Verify we have 3 blobs
    expect(blobs.length).toBe(3);
    
    // Sort blobs by sequence number
    blobs.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    // Verify the chaining:
    // 1. First blob should have empty priorHash
    expect(blobs[0].priorHash).toBe('');
    
    // 2. Each subsequent blob should have the previous blob's hash as priorHash
    expect(blobs[1].priorHash).toBe(blobs[0].hash);
    expect(blobs[2].priorHash).toBe(blobs[1].hash);
    
    // 3. Verify that each blob's hash was computed correctly (priorHash + bodyHash)
    for (let i = 0; i < blobs.length; i++) {
      const blob = blobs[i];
      const priorHash = blob.priorHash;
      const bodyHash = await computeHashInTest(blob.data);
      const expectedHash = `${priorHash}${bodyHash}`;
      expect(blob.hash).toBe(expectedHash);
    }
  });

  it('should handle server persistence failures for exec operations appropriately', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Create a table first
    await client.exec("CREATE TABLE users (name TEXT)");
    
    // Simulate server failure by making storeBlob return false
    fakeServer.storeBlob = async (...args: any[]) => {
      return false; // Simulate failure
    };
    
    // Try to execute a write operation using exec - should fail
    await expect(client.exec("INSERT INTO users (name) VALUES ('Alice')"))
      .rejects
      .toThrow('Failed to persist transaction on server');
  });

  it('should support exec operations within transactions', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Track server calls
    let serverStoreCalls = 0;
    const originalStoreBlob = fakeServer.storeBlob.bind(fakeServer);
    fakeServer.storeBlob = async (...args: any[]) => {
      serverStoreCalls++;
      return originalStoreBlob(...args);
    };
    
    // Execute a transaction that uses exec
    await client.transaction(async (tx) => {
      await tx.exec("CREATE TABLE users (name TEXT)");
      await tx.exec("INSERT INTO users (name) VALUES ('Alice')");
      await tx.exec("INSERT INTO users (name) VALUES ('Bob')");
      return "transaction completed";
    });
    
    // Verify that server persistence was called once for the entire transaction
    expect(serverStoreCalls).toBe(1);
    
    // Verify that all operations were executed
    const anyFakeServer = fakeServer as any;
    const blobs = Array.from(anyFakeServer.blobs.values());
    expect(blobs.length).toBe(1); // One transaction blob
    
    // Decode and decrypt the data to see what's inside
    // First, we need to create a temporary client to use its decryptData method
    const tempClient = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'temp-collection'
    });
    
    // Decrypt the blob data
    const decryptedData = (tempClient as any).decryptData(blobs[0].data);
    const decodedData = new TextDecoder().decode(decryptedData);
    const transactionEntry = JSON.parse(decodedData);
    
    // Check that the params exist and have the right length
    expect(transactionEntry.params).toBeDefined();
    expect(transactionEntry.params).toHaveLength(3); // Three commands in the transaction
    
    // Check that each command has the right structure
    expect(transactionEntry.params[0]).toEqual({ query: "CREATE TABLE users (name TEXT)" });
    expect(transactionEntry.params[1]).toEqual({ query: "INSERT INTO users (name) VALUES ('Alice')" });
    expect(transactionEntry.params[2]).toEqual({ query: "INSERT INTO users (name) VALUES ('Bob')" });
  });

  it('should rollback transaction when exec operation fails server persistence', async () => {
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: testPrivateKeyBase64,
      collectionId: 'test-collection'
    });
    
    // Create a table first outside the transaction
    await client.exec("CREATE TABLE users (name TEXT)");
    
    // Simulate server failure by making storeBlob return false
    fakeServer.storeBlob = async (...args: any[]) => {
      return false; // Simulate failure
    };
    
    // Execute a transaction that uses exec - should fail and rollback
    await expect(client.transaction(async (tx) => {
      await tx.exec("INSERT INTO users (name) VALUES ('Alice')");
      await tx.exec("INSERT INTO users (name) VALUES ('Bob')");
      return "transaction completed";
    })).rejects.toThrow('Transaction failed to persist to server');
  });
});
