// Tests for automatic prefetch functionality built into sync()
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeServer, createTestClient } from '../src/index';
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

  it('should auto-prefetch after an incomplete sync and reuse it on the next call', async () => {
    // Writer creates 4 blobs
    const writer = await createTestClient({ server });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');
    await writerStream.exec('INSERT INTO test VALUES (2)');
    await writerStream.exec('INSERT INTO test VALUES (3)');

    const reader = await createTestClient({ server });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Spy on getBlobsArrow to count how many network requests are made
    const spy = vi.spyOn(server, 'getBlobsArrow');

    // First sync: fetches blobs 1-2, should auto-prefetch blobs 3-4
    let status = await readerStream.sync(2);
    expect(status.complete()).toBe(false);
    expect(status.currentIndex).toBe(2);
    expect(spy).toHaveBeenCalledTimes(2); // 1 for sync fetch + 1 for prefetch

    // Second sync: should reuse the prefetched result (no new network call for fetch)
    status = await readerStream.sync(2);
    expect(status.complete()).toBe(true);
    expect(status.currentIndex).toBe(4);
    // Should still be 2 — the second sync reused the prefetch, no new fetch needed.
    // (No new prefetch fired either since sync completed.)
    expect(spy).toHaveBeenCalledTimes(2);

    // Verify all data was applied correctly
    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(3);
    expect(result.rows.map((r: any) => r.id)).toEqual([1, 2, 3]);
  });

  it('should not prefetch when sync is complete', async () => {
    const writer = await createTestClient({ server });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');

    const reader = await createTestClient({ server });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    const spy = vi.spyOn(server, 'getBlobsArrow');

    const status = await readerStream.sync(10);
    expect(status.complete()).toBe(true);
    // Only 1 call — the fetch itself. No prefetch since we're complete.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should invalidate prefetch when max changes between sync calls', async () => {
    const writer = await createTestClient({ server });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');
    await writerStream.exec('INSERT INTO test VALUES (2)');
    await writerStream.exec('INSERT INTO test VALUES (3)');

    const reader = await createTestClient({ server });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    const spy = vi.spyOn(server, 'getBlobsArrow');

    // First sync with max=2: fetches blobs 1-2, prefetches with max=2
    let status = await readerStream.sync(2);
    expect(status.complete()).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2); // fetch + prefetch

    // Second sync with max=10: prefetch has max=2, doesn't match, so discarded
    status = await readerStream.sync(10);
    expect(status.complete()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(3); // +1 fresh fetch (prefetch discarded)

    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(3);
  });

  it('should invalidate prefetch when sync index advances between calls', async () => {
    const writer = await createTestClient({ server });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');
    await writerStream.exec('INSERT INTO test VALUES (2)');
    await writerStream.exec('INSERT INTO test VALUES (3)');
    await writerStream.exec('INSERT INTO test VALUES (4)');

    const reader = await createTestClient({ server });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    const spy = vi.spyOn(server, 'getBlobsArrow');

    // Sync 1 blob at a time — first call fetches blob 1, prefetches from 1
    let status = await readerStream.sync(1);
    expect(status.complete()).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2); // fetch + prefetch

    // Second sync: prefetch was cached at startSequence=1. After the first
    // sync, lastSyncIndex=1, so prefetch matches and is reused. But after
    // processing blob 2, a new prefetch fires from index 2.
    status = await readerStream.sync(1);
    expect(status.complete()).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3); // prefetch reused, but new prefetch fires after

    // Now sync with max=2 (different max) — cached prefetch (max=1) is invalidated
    status = await readerStream.sync(2);
    expect(status.complete()).toBe(false);
    expect(spy).toHaveBeenCalledTimes(5); // +1 fresh fetch (stale discarded) + 1 new prefetch

    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(3); // CREATE TABLE + 3 INSERTs synced
  });

  it('should handle stale prefetch when new blobs arrive on server after prefetch fires', async () => {
    // This tests the critical correctness scenario:
    // 1. sync() fetches blobs 1-2 and auto-prefetches from index 2
    // 2. Writer adds blob 6 to server (after prefetch fired)
    // 3. Next sync() uses the prefetched result (blobs 3-4, stale totalCount=5)
    // 4. Verify: blobs are applied correctly, no double-applies
    // 5. Subsequent syncs pick up the remaining blobs

    const writer = await createTestClient({ server });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    await writerStream.exec('INSERT INTO test VALUES (1)');
    await writerStream.exec('INSERT INTO test VALUES (2)');
    await writerStream.exec('INSERT INTO test VALUES (3)');
    await writerStream.exec('INSERT INTO test VALUES (4)');
    // 5 blobs on server now (CREATE + 4 INSERTs)

    const reader = await createTestClient({ server });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    // Sync batch 1: blobs 1-2, auto-prefetches from index 2 (will get blobs 3-4)
    let status = await readerStream.sync(2);
    expect(status.complete()).toBe(false);
    expect(status.currentIndex).toBe(2);

    // Now the writer adds more blobs AFTER the prefetch was issued.
    // The prefetch already fired and captured blobs 3-4 with totalCount=5.
    await writerStream.exec('INSERT INTO test VALUES (5)');
    await writerStream.exec('INSERT INTO test VALUES (6)');
    // Server now has 7 blobs

    // Sync batch 2: uses prefetched result (blobs 3-4, stale totalCount=5)
    status = await readerStream.sync(2);
    expect(status.complete()).toBe(false); // Not complete — at least 1 more blob (5)
    expect(status.currentIndex).toBe(4);

    // Continue syncing to pick up remaining blobs (5, 6, 7)
    status = await readerStream.sync(2);
    expect(status.complete()).toBe(false);
    expect(status.currentIndex).toBe(6);

    status = await readerStream.sync(2);
    expect(status.complete()).toBe(true);
    expect(status.currentIndex).toBe(7);

    // Verify ALL data — no misses, no duplicates
    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(6);
    expect(result.rows.map((r: any) => r.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('should pipeline correctly through a full sync loop', async () => {
    // Simulates the real-world sync loop pattern:
    // sync → local work → sync (reuses prefetch) → local work → ...
    const writer = await createTestClient({ server });
    const writerStream = await writer.addWriteKey('test', privateKeyBase64);
    await writerStream.exec('CREATE TABLE test (id INTEGER)');
    for (let i = 1; i <= 10; i++) {
      await writerStream.exec(`INSERT INTO test VALUES (${i})`);
    }

    const reader = await createTestClient({ server });
    const readerStream = await reader.addWriteKey('test', privateKeyBase64);

    const spy = vi.spyOn(server, 'getBlobsArrow');

    let synced = false;
    let iterations = 0;
    while (!synced) {
      const status = await readerStream.sync(3);
      synced = status.complete();
      iterations++;
    }

    // With 11 blobs and max=3: need ceil(11/3) = 4 sync iterations
    expect(iterations).toBe(4);

    // Without prefetch, we'd need 4 fetches. With prefetch, the first sync
    // fires fetch #1, auto-prefetch #2; second sync reuses #2, auto-prefetch #3;
    // third sync reuses #3, auto-prefetch #4; fourth sync reuses #4, complete.
    // Total: 4 fetches + 3 prefetches = 7 calls, but only 4 are on the critical
    // path — the 3 prefetches overlap with the caller's time between syncs.
    // However, since this is a tight loop with no real work between syncs,
    // the prefetches still fire. 4 sync fetches + 3 auto-prefetches = 7.
    // But the first sync makes a fresh fetch (no prefetch yet) = 1.
    // Then auto-prefetch fires = 2. Second sync reuses = still 2, auto-prefetch = 3.
    // Third sync reuses = 3, auto-prefetch = 4. Fourth sync reuses = 4, no prefetch (complete).
    // Total getBlobsArrow calls = 4 (1 initial + 3 prefetches).
    expect(spy).toHaveBeenCalledTimes(4);

    const result: any = await readerStream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(10);
  });

  it('should handle prefetch with empty server', async () => {
    const client = await createTestClient({ server });
    const stream = await client.addWriteKey('test', privateKeyBase64);

    const spy = vi.spyOn(server, 'getBlobsArrow');
    const status = await stream.sync(10);
    expect(status.complete()).toBe(true);
    expect(status.currentIndex).toBe(0);
    expect(status.finalIndex).toBe(0);
    // No prefetch since already complete
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should work correctly when writer is also the reader (self-sync)', async () => {
    const client = await createTestClient({ server });
    const stream = await client.addWriteKey('test', privateKeyBase64);

    await stream.exec('CREATE TABLE test (id INTEGER)');
    await stream.exec('INSERT INTO test VALUES (1)');
    await stream.exec('INSERT INTO test VALUES (2)');

    // Self-sync — all blobs already applied locally
    const status = await stream.sync(10);
    expect(status.complete()).toBe(true);

    const result: any = await stream.local().query('SELECT * FROM test ORDER BY id');
    expect(result.rows.length).toBe(2);
  });
});
