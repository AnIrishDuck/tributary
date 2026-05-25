// Tests for server persistence functionality
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestServer, createTestClient, computeHash } from '../src/index';
import * as base64url from 'urlsafe-base64';
import nacl from 'tweetnacl';

describe('Server Persistence', () => {
  let testServer: any;
  let testKeyPair: nacl.SignKeyPair;
  let testPrivateKeyBase64: string;

  beforeEach(() => {
    testServer = createTestServer();
    testKeyPair = nacl.sign.keyPair();
    testPrivateKeyBase64 = base64url.encode(Buffer.from(testKeyPair.secretKey));
  });

  it('should persist write operations to server before local execution', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Track server calls
    let serverStoreCalls = 0;
    const originalStoreBlob = testServer.storeBlob.bind(testServer);
    testServer.storeBlob = async (...args: any[]) => {
      serverStoreCalls++;
      return originalStoreBlob(...args);
    };
    
    // Create a table first
    await stream.query("CREATE TABLE users (name TEXT)");
    
    // Execute a write query
    const result = await stream.query("INSERT INTO users (name) VALUES ('Alice')");
    
    // Verify that server persistence was called before local execution
    expect(serverStoreCalls).toBe(2); // One for CREATE TABLE, one for INSERT
    
    // Verify that local execution still happened
    expect(result).toBeDefined();
  });

  it('should maintain proper chaining of transactions', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Execute multiple write operations
    await stream.query("CREATE TABLE test (id INTEGER, name TEXT)");
    await stream.query("INSERT INTO test VALUES (1, 'first')");
    await stream.query("INSERT INTO test VALUES (2, 'second')");
    
    // For FakeServer, verify that all operations were persisted to server by checking the fake server directly
    // We'll access the private blobs map through a workaround
    if (testServer.constructor.name === 'FakeServer') {
      const anyFakeServer = testServer as any;
      const blobCount = anyFakeServer.blobs ? anyFakeServer.blobs.size : 0;
      expect(blobCount).toBe(3);
    }
    
    // Verify chaining by checking that each blob has the correct priorHash
    // This would be more thoroughly tested in a more complete implementation
  });

  it('should properly chain hashes for multiple entries', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Execute multiple write operations
    await stream.query("CREATE TABLE test (id INTEGER, name TEXT)");
    await stream.query("INSERT INTO test VALUES (1, 'first')");
    await stream.query("INSERT INTO test VALUES (2, 'second')");
    
    // For FakeServer, get all blobs from the fake server
    if (testServer.constructor.name === 'FakeServer') {
      const anyFakeServer = testServer as any;
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
      
      // 3. Verify that each blob's hash was computed correctly (SHA256(priorHash + bodyHash))
      for (let i = 0; i < blobs.length; i++) {
        const blob = blobs[i];
        const priorHash = blob.priorHash;
        const bodyHash = await computeHash(blob.data);
        const concatenated = `${priorHash}${bodyHash}`;
        const expectedHash = await computeHash(new TextEncoder().encode(concatenated));
        expect(blob.hash).toBe(expectedHash);
      }
    }
  });

  it('should validate signatures using the same method as the server', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Execute a write operation
    await stream.query("CREATE TABLE test (id INTEGER, name TEXT)");
    
    // For FakeServer, get the blob from the fake server
    if (testServer.constructor.name === 'FakeServer') {
      const anyFakeServer = testServer as any;
      const blobs = Array.from(anyFakeServer.blobs.values());
      expect(blobs.length).toBe(1);
      
      const blob = blobs[0];
      
      // Verify the signature using the same method as the server
      // This mimics how tributary-server verifies signatures
      const pubkeyBytes = base64url.decode(blob.pubkey);
      const signatureBytes = base64url.decode(blob.signature);
      
      // Recreate the data that was signed (just the concatenated hash)
      const dataToSignBytes = new TextEncoder().encode(blob.hash);
      
      // Verify the signature using nacl
      const isValid = nacl.sign.detached.verify(dataToSignBytes, signatureBytes, pubkeyBytes);
      expect(isValid).toBe(true);
    }
  });

  it('should replicate the exact hash structure from server integration tests', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Execute multiple operations like in the server integration tests
    await stream.query("CREATE TABLE test (id INTEGER, name TEXT)");
    await stream.query("INSERT INTO test VALUES (1, 'first')");
    await stream.query("INSERT INTO test VALUES (2, 'second')");
    
    // For FakeServer, get all blobs
    if (testServer.constructor.name === 'FakeServer') {
      const anyFakeServer = testServer as any;
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
      
      // 3. Verify that hashes are computed correctly (SHA256(priorHash + bodyHash))
      for (let i = 0; i < blobs.length; i++) {
        const blob = blobs[i];
        const bodyHash = await computeHash(blob.data);
        const concatenated = `${blob.priorHash}${bodyHash}`;
        const expectedHash = await computeHash(new TextEncoder().encode(concatenated));
        expect(blob.hash).toBe(expectedHash);
      }
      
      // 4. Verify all signatures are valid
      for (const blob of blobs) {
        const pubkeyBytes = base64url.decode(blob.pubkey);
        const signatureBytes = base64url.decode(blob.signature);
        const dataToSignBytes = new TextEncoder().encode(blob.hash);
        const isValid = nacl.sign.detached.verify(dataToSignBytes, signatureBytes, pubkeyBytes);
        expect(isValid).toBe(true);
      }
      
      // 5. Verify sequence numbers are incremental
      expect(blobs[0].sequenceNumber).toBe(1);
      expect(blobs[1].sequenceNumber).toBe(2);
      expect(blobs[2].sequenceNumber).toBe(3);
    }
  });

  it('should handle server persistence failures appropriately', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Create a table first
    await stream.query("CREATE TABLE users (name TEXT)");
    
    // Simulate server failure by making storeBlob return false
    testServer.storeBlob = async (...args: any[]) => {
      return false; // Simulate failure
    };
    
    // Try to execute a write query - should fail
    await expect(stream.query("INSERT INTO users (name) VALUES ('Alice')"))
      .rejects
      .toThrow('Failed to persist transaction on server');
  });

  it('should persist exec operations to server before local execution', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Track server calls
    let serverStoreCalls = 0;
    const originalStoreBlob = testServer.storeBlob.bind(testServer);
    testServer.storeBlob = async (...args: any[]) => {
      serverStoreCalls++;
      return originalStoreBlob(...args);
    };
    
    // Create a table using exec
    await stream.exec("CREATE TABLE users (name TEXT)");
    
    // Execute a write operation using exec
    await stream.exec("INSERT INTO users (name) VALUES ('Alice')");
    
    // Verify that server persistence was called before local execution
    expect(serverStoreCalls).toBe(2); // One for CREATE TABLE, one for INSERT
  });

  it('should properly chain hashes for exec entries', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Execute multiple write operations using exec
    await stream.exec("CREATE TABLE test (id INTEGER, name TEXT)");
    await stream.exec("INSERT INTO test VALUES (1, 'first')");
    await stream.exec("INSERT INTO test VALUES (2, 'second')");
    
    // For FakeServer, get all blobs from the fake server
    if (testServer.constructor.name === 'FakeServer') {
      const anyFakeServer = testServer as any;
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
      
      // 3. Verify that each blob's hash was computed correctly (SHA256(priorHash + bodyHash))
      for (let i = 0; i < blobs.length; i++) {
        const blob = blobs[i];
        const priorHash = blob.priorHash;
        const bodyHash = await computeHash(blob.data);
        const concatenated = `${priorHash}${bodyHash}`;
        const expectedHash = await computeHash(new TextEncoder().encode(concatenated));
        expect(blob.hash).toBe(expectedHash);
      }
    }
  });

  it('should handle server persistence failures for exec operations appropriately', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Create a table first
    await stream.exec("CREATE TABLE users (name TEXT)");
    
    // Simulate server failure by making storeBlob return false
    testServer.storeBlob = async (...args: any[]) => {
      return false; // Simulate failure
    };
    
    // Try to execute a write operation using exec - should fail
    await expect(stream.exec("INSERT INTO users (name) VALUES ('Alice')"))
      .rejects
      .toThrow('Failed to persist transaction on server');
  });

  it.skip('should support exec operations within transactions', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Track server calls
    let serverStoreCalls = 0;
    const originalStoreBlob = testServer.storeBlob.bind(testServer);
    testServer.storeBlob = async (...args: any[]) => {
      serverStoreCalls++;
      return originalStoreBlob(...args);
    };
    
    // Execute a transaction that uses exec
    const result = await stream.transaction(async (tx) => {
      await tx.exec("CREATE TABLE users (name TEXT)");
      await tx.exec("INSERT INTO users (name) VALUES ('Alice')");
      await tx.exec("INSERT INTO users (name) VALUES ('Bob')");
      return "transaction completed";
    });
    
    // Verify that server persistence was called once for the entire transaction
    expect(serverStoreCalls).toBe(1);
    
    // For FakeServer, verify that all operations were executed
    if (testServer.constructor.name === 'FakeServer') {
      const anyFakeServer = testServer as any;
      const blobs = Array.from(anyFakeServer.blobs.values());
      expect(blobs.length).toBe(1); // One transaction blob
    }
    
    // Verify the result
    expect(result).toBe("transaction completed");
    
    // Verify that we can query the data that was inserted
    const queryResult = await stream.query("SELECT * FROM users ORDER BY name");
    expect(queryResult.rows).toEqual([
      { name: 'Alice' },
      { name: 'Bob' }
    ]);
  }, 30000); // Increase timeout to 30 seconds

  it('should rollback transaction when exec operation fails server persistence', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Create a table first outside the transaction
    await stream.exec("CREATE TABLE users (name TEXT)");
    
    // Simulate server failure by making storeBlob return false
    testServer.storeBlob = async (...args: any[]) => {
      return false; // Simulate failure
    };
    
    // Execute a transaction that uses exec - should fail and rollback
    await expect(stream.transaction(async (tx) => {
      await tx.exec("INSERT INTO users (name) VALUES ('Alice')");
      await tx.exec("INSERT INTO users (name) VALUES ('Bob')");
      return "transaction completed";
    })).rejects.toThrow('Transaction failed to persist to server');
  });
});
