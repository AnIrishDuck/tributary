// Tests for exec functionality
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestServer, createTestClient } from '../src/index';
import * as base64url from 'urlsafe-base64';
import nacl from 'tweetnacl';

describe('Exec Functionality', () => {
  let testServer: any;
  let testKeyPair: nacl.SignKeyPair;
  let testPrivateKeyBase64: string;

  beforeEach(() => {
    testServer = createTestServer();
    testKeyPair = nacl.sign.keyPair();
    testPrivateKeyBase64 = base64url.encode(Buffer.from(testKeyPair.secretKey));
  });

  it('should execute CREATE TABLE command with exec', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Execute CREATE TABLE using exec
    await stream.exec("CREATE TABLE users (id INTEGER, name TEXT)");
    
    // Verify table was created by querying it
    const result = await stream.query("SELECT * FROM users");
    expect(result.rows).toEqual([]);
  });

  it('should execute INSERT command with exec', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Create table first
    await stream.exec("CREATE TABLE users (id INTEGER, name TEXT)");
    
    // Execute INSERT using exec
    await stream.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
    
    // Verify data was inserted
    const result = await stream.query("SELECT * FROM users");
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('should execute UPDATE command with exec', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Create table and insert data first
    await stream.exec("CREATE TABLE users (id INTEGER, name TEXT)");
    await stream.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
    
    // Execute UPDATE using exec
    await stream.exec("UPDATE users SET name = 'Bob' WHERE id = 1");
    
    // Verify data was updated
    const result = await stream.query("SELECT * FROM users");
    expect(result.rows).toEqual([{ id: 1, name: 'Bob' }]);
  });

  it('should execute DELETE command with exec', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Create table and insert data first
    await stream.exec("CREATE TABLE users (id INTEGER, name TEXT)");
    await stream.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
    await stream.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')");
    
    // Execute DELETE using exec
    await stream.exec("DELETE FROM users WHERE id = 1");
    
    // Verify data was deleted
    const result = await stream.query("SELECT * FROM users");
    expect(result.rows).toEqual([{ id: 2, name: 'Bob' }]);
  });

  it('should persist exec operations to server with proper chaining', async () => {
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
    
    // Execute multiple exec operations
    await stream.exec("CREATE TABLE users (id INTEGER, name TEXT)");
    await stream.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
    await stream.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')");
    
    // Get all blobs from the fake server
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
  });

  it.skip('should support exec in transactions with mixed query and exec operations', async () => {
    const client = await createTestClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Execute a transaction that uses both query and exec
    const result = await stream.transaction(async (tx) => {
      await tx.exec("CREATE TABLE users (id INTEGER, name TEXT)");
      await tx.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");
      await tx.exec("INSERT INTO users (id, name) VALUES (2, 'Bob')");
      
      // Also use query to check results within the transaction
      const queryResult = await tx.query("SELECT COUNT(*) as count FROM users");
      expect(queryResult.rows[0].count).toBe(2);
      
      return "transaction completed";
    });
    
    expect(result).toBe("transaction completed");
    
    // Verify that all operations were executed by querying the final state
    const finalResult = await stream.query("SELECT * FROM users ORDER BY id");
    expect(finalResult.rows).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ]);
  });
});
