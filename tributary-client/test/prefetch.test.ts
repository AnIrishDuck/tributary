// Tests for prefetch functionality
import { describe, it, expect, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { TributaryClient, FakeServer } from '../src/index';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';

describe('Prefetch', () => {
  let server: FakeServer;
  let keyPair: nacl.SignKeyPair;
  let privateKeyBase64: string;

  beforeEach(() => {
    server = new FakeServer();
    keyPair = nacl.sign.keyPair();
    privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey));
  });

  it('should prefetch and use cached result in sync', async () => {
    // Writer creates blobs on the server
    const writer = new TributaryClient({ server, db: new PGlite() });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');
    await writerStream.exec('INSERT INTO test VALUES (2)');

    // Reader syncs using prefetch
    const reader = new TributaryClient({ server, db: new PGlite() });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Prefetch before sync
    await readerStream.prefetch(10);

    // Sync should use the prefetched result
    const status = await readerStream.sync(10);
    expect(status.complete()).toBe(true);
    expect(status.currentIndex).toBe(3);

    // Verify data was applied correctly
    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(2);
    expect(result.rows[0].id).toBe(1);
    expect(result.rows[1].id).toBe(2);
  });

  it('should invalidate prefetch when max does not match', async () => {
    const writer = new TributaryClient({ server, db: new PGlite() });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');
    await writerStream.exec('INSERT INTO test VALUES (2)');

    const reader = new TributaryClient({ server, db: new PGlite() });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Prefetch with max=5
    await readerStream.prefetch(5);

    // Sync with different max=10 should not use the prefetch
    const status = await readerStream.sync(10);
    expect(status.complete()).toBe(true);
    expect(status.currentIndex).toBe(3);

    // Data should still be correct
    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(2);
  });

  it('should invalidate prefetch when sync index has changed', async () => {
    const writer = new TributaryClient({ server, db: new PGlite() });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');
    await writerStream.exec('INSERT INTO test VALUES (2)');
    await writerStream.exec('INSERT INTO test VALUES (3)');

    const reader = new TributaryClient({ server, db: new PGlite() });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Prefetch from index 0
    await readerStream.prefetch(2);

    // Sync first batch without prefetch (different max)
    let status = await readerStream.sync(1);
    expect(status.complete()).toBe(false);
    expect(status.currentIndex).toBe(1);

    // Now the lastSyncIndex is 1, but the prefetch was from index 0
    // So syncing with max=2 should NOT use the stale prefetch
    status = await readerStream.sync(2);
    expect(status.complete()).toBe(false);

    // Finish syncing
    status = await readerStream.sync(10);
    expect(status.complete()).toBe(true);

    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(3);
  });

  it('should work with multiple prefetch-sync cycles', async () => {
    const writer = new TributaryClient({ server, db: new PGlite() });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');
    await writerStream.exec('INSERT INTO test VALUES (2)');
    await writerStream.exec('INSERT INTO test VALUES (3)');
    await writerStream.exec('INSERT INTO test VALUES (4)');
    await writerStream.exec('INSERT INTO test VALUES (5)');

    const reader = new TributaryClient({ server, db: new PGlite() });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Cycle 1: prefetch + sync 2 blobs
    await readerStream.prefetch(2);
    let status = await readerStream.sync(2);
    expect(status.complete()).toBe(false);
    expect(status.currentIndex).toBe(2);

    // Cycle 2: prefetch + sync 2 more blobs
    await readerStream.prefetch(2);
    status = await readerStream.sync(2);
    expect(status.complete()).toBe(false);
    expect(status.currentIndex).toBe(4);

    // Cycle 3: prefetch + sync remaining
    await readerStream.prefetch(2);
    status = await readerStream.sync(2);
    expect(status.complete()).toBe(true);
    expect(status.currentIndex).toBe(6);

    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(5);
  });

  it('should handle prefetch when already fully synced', async () => {
    const client = new TributaryClient({ server, db: new PGlite() });
    const stream = await client.addWriteKey('test', privateKeyBase64);
    await stream.exec('CREATE TABLE test (id INTEGER)');
    await stream.exec('INSERT INTO test VALUES (1)');

    // Already synced since we wrote locally
    await stream.prefetch(10);
    const status = await stream.sync(10);
    expect(status.complete()).toBe(true);
  });

  it('should allow calling prefetch multiple times (last one wins)', async () => {
    const writer = new TributaryClient({ server, db: new PGlite() });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');

    const reader = new TributaryClient({ server, db: new PGlite() });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Call prefetch twice - second should overwrite first
    await readerStream.prefetch(5);
    await readerStream.prefetch(10);

    // Sync with max=10 should use the second prefetch
    const status = await readerStream.sync(10);
    expect(status.complete()).toBe(true);
    expect(status.currentIndex).toBe(2);
  });

  it('should not use prefetch if sync is called without prefetch', async () => {
    const writer = new TributaryClient({ server, db: new PGlite() });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');

    const reader = new TributaryClient({ server, db: new PGlite() });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Sync without prefetch should work normally
    const status = await readerStream.sync(10);
    expect(status.complete()).toBe(true);
    expect(status.currentIndex).toBe(2);

    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(1);
  });

  it('should clear prefetch cache after sync consumes it', async () => {
    const writer = new TributaryClient({ server, db: new PGlite() });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');
    await writerStream.exec('INSERT INTO test VALUES (2)');
    await writerStream.exec('INSERT INTO test VALUES (3)');

    const reader = new TributaryClient({ server, db: new PGlite() });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Prefetch + sync consumes the cache
    await readerStream.prefetch(2);
    let status = await readerStream.sync(2);
    expect(status.complete()).toBe(false);

    // Second sync without prefetch should still work (no stale cache)
    status = await readerStream.sync(2);
    expect(status.complete()).toBe(true);

    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(3);
  });

  it('should handle prefetch with empty server', async () => {
    const client = new TributaryClient({ server, db: new PGlite() });
    const stream = await client.addWriteKey('test', privateKeyBase64);

    await stream.prefetch(10);
    const status = await stream.sync(10);
    expect(status.complete()).toBe(true);
    expect(status.currentIndex).toBe(0);
    expect(status.finalIndex).toBe(0);
  });

  it('should pipeline prefetch with local work correctly', async () => {
    // Simulates the real-world use case: sync → local work → prefetch → sync
    const writer = new TributaryClient({ server, db: new PGlite() });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    for (let i = 1; i <= 10; i++) {
      await writerStream.exec(`INSERT INTO test VALUES (${i})`);
    }

    const reader = new TributaryClient({ server, db: new PGlite() });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Simulate the pipelining loop
    let synced = false;
    let iterations = 0;
    while (!synced) {
      const status = await readerStream.sync(3);
      synced = status.complete();
      iterations++;

      if (!synced) {
        // Start prefetching next batch while doing "local work"
        await readerStream.prefetch(3);
      }
    }

    // Should have taken multiple iterations
    expect(iterations).toBeGreaterThan(1);

    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(10);
  });

  it('should invalidate prefetch when a local write changes the sync index', async () => {
    const writer = new TributaryClient({ server, db: new PGlite() });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');

    const reader = new TributaryClient({ server, db: new PGlite() });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Sync first to get the CREATE TABLE
    await readerStream.sync(10);

    // Prefetch from current index
    await readerStream.prefetch(10);

    // Now do a local write - this advances lastSyncIndex past what was prefetched
    await readerStream.exec('INSERT INTO test VALUES (99)');

    // Sync should invalidate the prefetch since lastSyncIndex changed
    const status = await readerStream.sync(10);
    expect(status.complete()).toBe(true);

    // Both values should be present
    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.map((r: any) => r.id)).toContain(1);
    expect(result.rows.map((r: any) => r.id)).toContain(99);
  });
});
