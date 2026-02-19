// Test for sync functionality
import { describe, it, expect, beforeEach } from 'vitest';
import { TributaryClient, createTestServer } from '../src/index';
import { PGlite } from '@electric-sql/pglite';
import * as base64url from 'urlsafe-base64';
import nacl from 'tweetnacl';

describe('Sync Functionality', () => {
  let testServer: any;
  let testKeyPair: nacl.SignKeyPair;
  let testPrivateKeyBase64: string;

  beforeEach(() => {
    testServer = createTestServer();
    testKeyPair = nacl.sign.keyPair();
    testPrivateKeyBase64 = base64url.encode(Buffer.from(testKeyPair.secretKey));
  });

  it('should track last sync index in database and avoid replaying commands', async () => {
    const client = new TributaryClient({
      server: testServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey('test', testPrivateKeyBase64);
    
    // Execute some operations to create blobs on the server
    await stream.query("CREATE TABLE test (id INTEGER, name TEXT)");
    await stream.query("INSERT INTO test VALUES (1, 'first')");
    await stream.query("INSERT INTO test VALUES (2, 'second')");
    
    // For FakeServer, verify that all operations were persisted to server
    if (testServer.constructor.name === 'FakeServer') {
      const anyFakeServer = testServer as any;
      const blobs = Array.from(anyFakeServer.blobs.values());
      expect(blobs.length).toBe(3);
    }
    
    // Get the blob metadata before sync to verify filtering works
    const blobMetadataBefore = await testServer.getAllBlobMetadata(stream.getPublicKeyBase64());
    expect(blobMetadataBefore.blobs.length).toBe(3);
    
    // After executing operations locally, the lastSyncIndex should reflect the operations executed
    const initialLastSyncIndex = (stream as any).lastSyncIndex;
    expect(initialLastSyncIndex).toBe(3); // 3 operations executed locally
    
    // Sync the client - should process 0 blobs since they were already applied locally
    await stream.sync(10000);
    
    // Check that last sync index remains the same (no new blobs processed)
    const streamAny = stream as any;
    expect(streamAny.lastSyncIndex).toBe(3);
    
    // Add another operation to the server
    await stream.query("INSERT INTO test VALUES (3, 'third')");
    
    // Get updated blob metadata
    const blobMetadataAfter = await testServer.getAllBlobMetadata(stream.getPublicKeyBase64());
    expect(blobMetadataAfter.blobs.length).toBe(4);
    
    // Now if we sync again, it should still process 0 new blobs (since the fourth operation was also applied locally)
    const syncIndexBeforeSecondSync = streamAny.lastSyncIndex;
    await stream.sync(10000);
    const syncIndexAfterSecondSync = streamAny.lastSyncIndex;
    
    // Should remain at 4 (no new blobs processed during sync)
    expect(syncIndexAfterSecondSync).toBe(4);
  });

  it('should not double process data when creating a new client with existing database', async () => {
    // Create a shared database instance
    const sharedDb = new PGlite();
    
    // Create first client and perform operations
    const client1 = new TributaryClient({
      server: testServer,
      db: sharedDb
    });
    
    // Add a stream to work with
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64);
    
    // Execute operations 
    await stream1.query("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");
    await stream1.query("INSERT INTO items VALUES (1, 'item1')");
    await stream1.query("INSERT INTO items VALUES (2, 'item2')");
    
    // Sync the first client
    await stream1.sync(10000);
    
    // Check initial count
    let result = await stream1.query("SELECT COUNT(*) as count FROM items");
    expect(result.rows[0].count).toBe(2);
    
    // Create a second client with the same database
    const client2 = new TributaryClient({
      server: testServer,
      db: sharedDb
    });
    
    // Get the same stream for the second client
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64);
    
    // Sync the second client - this should NOT duplicate the data
    await stream2.sync(10000);
    
    // Count should still be 2
    result = await stream2.query("SELECT COUNT(*) as count FROM items");
    expect(result.rows[0].count).toBe(2);
    
    // Add another item via the second client
    await stream2.query("INSERT INTO items VALUES (3, 'item3')");
    
    // Sync again
    await stream2.sync(10000);
    
    // Now we should have 3 items
    result = await stream2.query("SELECT COUNT(*) as count FROM items");
    expect(result.rows[0].count).toBe(3);
    
    // Sync first client again
    await stream1.sync(10000);
    
    // First client should also see 3 items
    result = await stream1.query("SELECT COUNT(*) as count FROM items");
    expect(result.rows[0].count).toBe(3);
  });

  it('should return true when fully synced and false when more blobs available', async () => {
    // Create two separate streams
    const freshDb1 = new PGlite();
    const freshDb2 = new PGlite();
    
    const freshClient1 = new TributaryClient({
      server: testServer,
      db: freshDb1
    });
    
    const freshClient2 = new TributaryClient({
      server: testServer,
      db: freshDb2
    });
    
    const stream1 = await freshClient1.addWriteKey('test', testPrivateKeyBase64);
    
    // Stream 1 creates 3 blobs on the server
    await stream1.query("CREATE TABLE test_table (id INTEGER)");
    await stream1.query("INSERT INTO test_table VALUES (1)");
    await stream1.query("INSERT INTO test_table VALUES (2)");
    
    // Verify server has 3 blobs
    const blobMetadata = await testServer.getAllBlobMetadata(stream1.getPublicKeyBase64());
    expect(blobMetadata.blobs.length).toBe(3);
    
    // Stream 2 (fresh) hasn't synced yet, so its lastSyncIndex = 0
    const stream2 = await freshClient2.addWriteKey('test', testPrivateKeyBase64);
    
    // First sync with max=2 should not be complete (more blobs available)
    const result1 = await stream2.sync(2);
    expect(result1.complete()).toBe(false);
    expect(result1.currentIndex).toBe(2);

    // Sync again with max=100 should be complete (now fully synced)
    const result2 = await stream2.sync(100);
    expect(result2.complete()).toBe(true);
    expect(result2.currentIndex).toBe(3);

    // Sync once more should still be complete
    const result3 = await stream2.sync(100);
    expect(result3.complete()).toBe(true);
  });
});
