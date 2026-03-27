// Tests for sync error recording and querying
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestServer, createTestClient, createTestDb } from '../src/index';
import * as base64url from 'urlsafe-base64';
import nacl from 'tweetnacl';

describe('Sync Errors', () => {
  let testServer: any;
  let testKeyPair: nacl.SignKeyPair;
  let testPrivateKeyBase64: string;

  beforeEach(() => {
    testServer = createTestServer();
    testKeyPair = nacl.sign.keyPair();
    testPrivateKeyBase64 = base64url.encode(Buffer.from(testKeyPair.secretKey));
  });

  it('should record a parse error when a blob cannot be decrypted', async () => {
    // Client 1 writes some blobs
    const db1 = await createTestDb();
    const client1 = await createTestClient({ server: testServer, db: db1 });
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64);

    await stream1.query("CREATE TABLE test (id INTEGER)");
    await stream1.query("INSERT INTO test VALUES (1)");

    // Corrupt the data of the second blob in the fake server
    const pubkey = stream1.getPublicKeyBase64();
    const allBlobs = Array.from(testServer.blobs.values()) as any[];
    const targetBlob = allBlobs.find(
      (b: any) => b.pubkey === pubkey && b.sequenceNumber === 2
    );
    // Overwrite with garbage bytes so decryption fails
    targetBlob.data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // Client 2 syncs from the server — blob 2 will fail to parse
    const db2 = await createTestDb();
    const client2 = await createTestClient({ server: testServer, db: db2 });
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64);

    // Sync should not throw — it skips unparseable blobs
    await stream2.sync(10000);

    // Check that an error was recorded
    const errors = await stream2.getErrors();
    expect(errors.length).toBeGreaterThanOrEqual(1);

    const parseError = errors.find((e) => e.error_type === 'parse_error');
    expect(parseError).toBeDefined();
    expect(parseError!.blob_sequence).toBe(2);
    expect(parseError!.stream_id).toBe(stream2.getId());
    expect(parseError!.error_message).toBeTruthy();
    expect(parseError!.occurred_at).toBeTruthy();
    // parse errors have no query/params since the blob couldn't be decoded
    expect(parseError!.query).toBeNull();
    expect(parseError!.params).toBeNull();
  });

  it('should return errors via client.getErrors() across all streams', async () => {
    const db1 = await createTestDb();
    const client1 = await createTestClient({ server: testServer, db: db1 });
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64);

    await stream1.query("CREATE TABLE test (id INTEGER)");

    // Corrupt the blob
    const pubkey = stream1.getPublicKeyBase64();
    const allBlobs = Array.from(testServer.blobs.values()) as any[];
    const targetBlob = allBlobs.find(
      (b: any) => b.pubkey === pubkey && b.sequenceNumber === 1
    );
    targetBlob.data = new Uint8Array([99, 98, 97]);

    // New client syncs and gets an error
    const db2 = await createTestDb();
    const client2 = await createTestClient({ server: testServer, db: db2 });
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64);
    await stream2.sync(10000);

    // Query errors via the client-level API
    const errors = await client2.getErrors();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0].error_type).toBe('parse_error');
  });

  it('should clear errors for a specific stream', async () => {
    const db1 = await createTestDb();
    const client1 = await createTestClient({ server: testServer, db: db1 });
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64);

    await stream1.query("CREATE TABLE test (id INTEGER)");

    // Corrupt the blob
    const pubkey = stream1.getPublicKeyBase64();
    const allBlobs = Array.from(testServer.blobs.values()) as any[];
    const targetBlob = allBlobs.find(
      (b: any) => b.pubkey === pubkey && b.sequenceNumber === 1
    );
    targetBlob.data = new Uint8Array([42]);

    // New client syncs
    const db2 = await createTestDb();
    const client2 = await createTestClient({ server: testServer, db: db2 });
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64);
    await stream2.sync(10000);

    // Verify errors exist
    let errors = await stream2.getErrors();
    expect(errors.length).toBeGreaterThanOrEqual(1);

    // Clear errors
    await stream2.clearErrors();

    // Verify errors are gone
    errors = await stream2.getErrors();
    expect(errors.length).toBe(0);
  });

  it('should clear all errors via client.clearErrors()', async () => {
    const db1 = await createTestDb();
    const client1 = await createTestClient({ server: testServer, db: db1 });
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64);

    await stream1.query("CREATE TABLE test (id INTEGER)");

    // Corrupt the blob
    const pubkey = stream1.getPublicKeyBase64();
    const allBlobs = Array.from(testServer.blobs.values()) as any[];
    const targetBlob = allBlobs.find(
      (b: any) => b.pubkey === pubkey && b.sequenceNumber === 1
    );
    targetBlob.data = new Uint8Array([42]);

    // New client syncs
    const db2 = await createTestDb();
    const client2 = await createTestClient({ server: testServer, db: db2 });
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64);
    await stream2.sync(10000);

    // Verify errors exist via client API
    let errors = await client2.getErrors();
    expect(errors.length).toBeGreaterThanOrEqual(1);

    // Clear all errors via client
    await client2.clearErrors();

    errors = await client2.getErrors();
    expect(errors.length).toBe(0);
  });

  it('should record an apply error with query and params when a blob fails to apply', async () => {
    // Client 1 creates a table and inserts data
    const db1 = await createTestDb();
    const client1 = await createTestClient({ server: testServer, db: db1 });
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64);

    await stream1.query("CREATE TABLE test (id INTEGER PRIMARY KEY)");
    await stream1.query("INSERT INTO test VALUES (1)");

    // Client 2 creates a conflicting table locally so the synced
    // CREATE TABLE blob will fail to apply (but gets rolled back per-blob)
    const db2 = await createTestDb();
    const client2 = await createTestClient({ server: testServer, db: db2 });
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64);

    // Pre-create a conflicting table in the same schema
    const local2 = stream2.local();
    await local2.exec("CREATE TABLE test (id TEXT)");

    // Sync should NOT throw — the SAVEPOINT logic rolls back the
    // conflicting blob and continues with the rest of the batch
    await stream2.sync(10000);

    // An apply_error should have been recorded with query details
    const errors = await stream2.getErrors();
    const applyError = errors.find((e) => e.error_type === 'apply_error');
    expect(applyError).toBeDefined();
    expect(applyError!.error_message).toBeTruthy();
    expect(applyError!.blob_sequence).toBe(1);
    // The query and params from the failed transaction should be captured
    expect(applyError!.query).toBeTruthy();
  });

  it('should not record errors when sync succeeds normally', async () => {
    const db1 = await createTestDb();
    const client1 = await createTestClient({ server: testServer, db: db1 });
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64);

    await stream1.query("CREATE TABLE test (id INTEGER)");
    await stream1.query("INSERT INTO test VALUES (1)");

    // Client 2 syncs successfully
    const db2 = await createTestDb();
    const client2 = await createTestClient({ server: testServer, db: db2 });
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64);
    await stream2.sync(10000);

    // No errors should exist
    const errors = await stream2.getErrors();
    expect(errors.length).toBe(0);

    // Verify the data actually synced
    const result = await stream2.query("SELECT * FROM test");
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].id).toBe(1);
  });
});
