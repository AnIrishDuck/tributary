// Tests verifying that bad local operations are caught before syncing to server
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestServer, createTestClient } from '../src/index';
import * as base64url from 'urlsafe-base64';
import nacl from 'tweetnacl';

describe('Write operation protection', () => {
  let testServer: any;
  let testKeyPair: nacl.SignKeyPair;
  let testPrivateKeyBase64: string;

  beforeEach(() => {
    testServer = createTestServer();
    testKeyPair = nacl.sign.keyPair();
    testPrivateKeyBase64 = base64url.encode(Buffer.from(testKeyPair.secretKey));
  });

  it('should throw on bad exec and not sync to server', async () => {
    const client = await createTestClient({ server: testServer });
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);

    // Create a table with a unique constraint and insert a row
    await stream.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    await stream.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");

    // Record blob count after setup
    const anyFakeServer = testServer as any;
    const blobCountBefore = anyFakeServer.blobs.size;
    expect(blobCountBefore).toBe(2);

    // Attempt to insert a duplicate primary key — should fail locally
    await expect(
      stream.exec("INSERT INTO users (id, name) VALUES (1, 'Bob')")
    ).rejects.toThrow();

    // Verify NO new blob was sent to the server
    expect(anyFakeServer.blobs.size).toBe(blobCountBefore);

    // Create a separate reader that syncs from the same server
    const readerClient = await createTestClient({ server: testServer });
    const readerStream = await readerClient.addWriteKey('test', testPrivateKeyBase64);
    await readerStream.sync(100);

    // The reader should see only the 2 good operations, not the bad one
    const result = await readerStream.query("SELECT * FROM users ORDER BY id");
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('should throw on bad query and not sync to server', async () => {
    const client = await createTestClient({ server: testServer });
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);

    // Create a table with a unique constraint and insert a row
    await stream.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    await stream.query("INSERT INTO users (id, name) VALUES (1, 'Alice')");

    const anyFakeServer = testServer as any;
    const blobCountBefore = anyFakeServer.blobs.size;
    expect(blobCountBefore).toBe(2);

    // Attempt to insert a duplicate via query() — should fail locally
    await expect(
      stream.query("INSERT INTO users (id, name) VALUES (1, 'Bob')")
    ).rejects.toThrow();

    // Verify NO new blob was sent to the server
    expect(anyFakeServer.blobs.size).toBe(blobCountBefore);

    // Create a separate reader and verify it does not see the bad transaction
    const readerClient = await createTestClient({ server: testServer });
    const readerStream = await readerClient.addWriteKey('test', testPrivateKeyBase64);
    await readerStream.sync(100);

    const result = await readerStream.query("SELECT * FROM users ORDER BY id");
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
  });

  it('should allow valid operations after a failed one', async () => {
    const client = await createTestClient({ server: testServer });
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);

    await stream.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
    await stream.exec("INSERT INTO users (id, name) VALUES (1, 'Alice')");

    // Bad operation — should fail and not sync
    await expect(
      stream.exec("INSERT INTO users (id, name) VALUES (1, 'Bob')")
    ).rejects.toThrow();

    // Good operation after failure — should succeed
    await stream.exec("INSERT INTO users (id, name) VALUES (2, 'Charlie')");

    const result = await stream.query("SELECT * FROM users ORDER BY id");
    expect(result.rows).toEqual([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Charlie' }
    ]);

    // Verify the server has exactly 3 blobs (CREATE + Alice + Charlie, not Bob)
    const anyFakeServer = testServer as any;
    expect(anyFakeServer.blobs.size).toBe(3);
  });
});
