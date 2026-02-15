// Tests for batch sync functionality with various edge cases
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { TributaryClient } from '../src/tributaryClient';
import { FakeServer } from '../src/fakeServer';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';

describe('Batch Sync Tests', () => {
  let server: FakeServer;
  let keyPair: nacl.SignKeyPair;
  let privateKeyBase64: string;

  beforeEach(async () => {
    server = new FakeServer();
    keyPair = nacl.sign.keyPair();
    privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey));
  });

  it('should sync in batches and return correct in-sync status', async () => {
    const client = new TributaryClient({ server, db: new PGlite() });
    const stream = await client.addWriteKey('test', privateKeyBase64);

    // Write 5 blobs
    await stream.exec('CREATE TABLE test (id INTEGER)');
    await stream.exec('INSERT INTO test VALUES (1)');
    await stream.exec('INSERT INTO test VALUES (2)');
    await stream.exec('INSERT INTO test VALUES (3)');
    await stream.exec('INSERT INTO test VALUES (4)');

    // Create a second client to sync
    const client2 = new TributaryClient({ server, db: new PGlite() });
    const stream2 = await client2.addWriteKey('test', privateKeyBase64);

    // Sync 2 blobs at a time
    let isFullySynced = await stream2.sync(2);
    expect(isFullySynced).toBe(false); // Should have more blobs

    isFullySynced = await stream2.sync(2);
    expect(isFullySynced).toBe(false); // Should still have more

    isFullySynced = await stream2.sync(2);
    expect(isFullySynced).toBe(true); // Should be fully synced now

    // Verify all data is present
    const result: any = await stream2.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(4);
    expect(result.rows[0].id).toBe(1);
    expect(result.rows[3].id).toBe(4);
  });

  it('should not reprocess the last synced blob', async () => {
    const client = new TributaryClient({ server, db: new PGlite() });
    const stream = await client.addWriteKey('test', privateKeyBase64);

    // Write 3 blobs
    await stream.exec('CREATE TABLE test (id INTEGER)');
    await stream.exec('INSERT INTO test VALUES (1)');
    await stream.exec('INSERT INTO test VALUES (2)');

    // Create a second client to sync
    const client2 = new TributaryClient({ server, db: new PGlite() });
    const stream2 = await client2.addWriteKey('test', privateKeyBase64);

    // Sync first 2 blobs
    let isFullySynced = await stream2.sync(2);
    expect(isFullySynced).toBe(false);

    // Verify 1 row (first INSERT)
    let result: any = await stream2.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].id).toBe(1);

    // Sync next batch - should NOT reprocess blob 2
    isFullySynced = await stream2.sync(2);
    expect(isFullySynced).toBe(true);

    // Verify we now have 2 rows (not 3 or more from duplicates)
    result = await stream2.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].id).toBe(1);
    expect(result.rows[1].id).toBe(2);
  });

  it('should handle max=1 without infinite loops', async () => {
    const client = new TributaryClient({ server, db: new PGlite() });
    const stream = await client.addWriteKey('test', privateKeyBase64);

    // Write 3 blobs
    await stream.exec('CREATE TABLE test (id INTEGER)');
    await stream.exec('INSERT INTO test VALUES (1)');
    await stream.exec('INSERT INTO test VALUES (2)');

    // Create a second client to sync
    const client2 = new TributaryClient({ server, db: new PGlite() });
    const stream2 = await client2.addWriteKey('test', privateKeyBase64);

    // Sync one blob at a time - this is a critical test case
    let isFullySynced = await stream2.sync(1);
    expect(isFullySynced).toBe(false);

    isFullySynced = await stream2.sync(1);
    expect(isFullySynced).toBe(false);

    isFullySynced = await stream2.sync(1);
    expect(isFullySynced).toBe(true);

    // Verify all data is present
    const result: any = await stream2.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(2);
  });

  it('should verify hash chain integrity during batch sync', async () => {
    const client = new TributaryClient({ server, db: new PGlite() });
    const stream = await client.addWriteKey('test', privateKeyBase64);

    // Write 5 blobs
    await stream.exec('CREATE TABLE test (id INTEGER)');
    await stream.exec('INSERT INTO test VALUES (1)');
    await stream.exec('INSERT INTO test VALUES (2)');
    await stream.exec('INSERT INTO test VALUES (3)');
    await stream.exec('INSERT INTO test VALUES (4)');

    // Verify all blobs are chained correctly on the server
    const allBlobs = server.getAllBlobs();
    expect(allBlobs.length).toBe(5);

    for (let i = 1; i < allBlobs.length; i++) {
      const currentBlob = allBlobs[i];
      const prevBlob = allBlobs[i - 1];
      expect(currentBlob.priorHash).toBe(prevBlob.hash);
    }

    // Create a second client and sync in batches
    const client2 = new TributaryClient({ server, db: new PGlite() });
    const stream2 = await client2.addWriteKey('test', privateKeyBase64);

    // Sync should verify chain integrity automatically
    await stream2.sync(2);
    await stream2.sync(2);
    await stream2.sync(2);

    // If we got here without errors, chain integrity was verified
    const result: any = await stream2.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(4);
  });
});
