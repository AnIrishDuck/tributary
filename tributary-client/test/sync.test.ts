// Test for sync functionality
import { describe, it, expect, beforeEach } from 'vitest';
import { TributaryClient, FakeServer } from '../src/index';
import { PGlite } from '@electric-sql/pglite';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import nacl from 'tweetnacl';

describe('Sync Functionality', () => {
  let fakeServer: FakeServer;
  let testKeyPair: nacl.SignKeyPair;
  let testPrivateKeyBase64: string;

  beforeEach(() => {
    fakeServer = new FakeServer();
    testKeyPair = nacl.sign.keyPair();
    testPrivateKeyBase64 = encodeBase64(testKeyPair.secretKey);
  });

  it('should track last sync index in database and avoid replaying commands', async () => {
    const client = new TributaryClient({
      server: fakeServer
    });
    
    // Add a stream to work with
    const stream = await client.addWriteKey(testPrivateKeyBase64, 'test', 'collection');
    
    // Execute some operations to create blobs on the server
    await stream.query("CREATE TABLE test (id INTEGER, name TEXT)");
    await stream.query("INSERT INTO test VALUES (1, 'first')");
    await stream.query("INSERT INTO test VALUES (2, 'second')");
    
    // Verify that all operations were persisted to server
    const anyFakeServer = fakeServer as any;
    const blobs = Array.from(anyFakeServer.blobs.values());
    expect(blobs.length).toBe(3);
    
    // Get the blob metadata before sync to verify filtering works
    const blobMetadataBefore = await fakeServer.getAllBlobMetadata(stream.getPublicKeyBase64());
    expect(blobMetadataBefore.length).toBe(3);
    
    // After executing operations locally, the lastSyncIndex should reflect the operations executed
    const initialLastSyncIndex = (stream as any).lastSyncIndex;
    expect(initialLastSyncIndex).toBe(3); // 3 operations executed locally
    
    // Sync the client - should process 0 blobs since they were already applied locally
    await stream.sync();
    
    // Check that last sync index remains the same (no new blobs processed)
    const streamAny = stream as any;
    expect(streamAny.lastSyncIndex).toBe(3);
    
    // Add another operation to the server
    await stream.query("INSERT INTO test VALUES (3, 'third')");
    
    // Get updated blob metadata
    const blobMetadataAfter = await fakeServer.getAllBlobMetadata(stream.getPublicKeyBase64());
    expect(blobMetadataAfter.length).toBe(4);
    
    // Now if we sync again, it should still process 0 new blobs (since the fourth operation was also applied locally)
    const syncIndexBeforeSecondSync = streamAny.lastSyncIndex;
    await stream.sync();
    const syncIndexAfterSecondSync = streamAny.lastSyncIndex;
    
    // Should remain at 4 (no new blobs processed during sync)
    expect(syncIndexAfterSecondSync).toBe(4);
  });

  it('should not double process data when creating a new client with existing database', async () => {
    // Create a shared database instance
    const sharedDb = new PGlite();
    
    // Create first client and perform operations
    const client1 = new TributaryClient({
      server: fakeServer,
      db: sharedDb
    });
    
    // Add a stream to work with
    const stream1 = await client1.addWriteKey(testPrivateKeyBase64, 'test', 'collection');
    
    // Execute operations 
    await stream1.query("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");
    await stream1.query("INSERT INTO items VALUES (1, 'item1')");
    await stream1.query("INSERT INTO items VALUES (2, 'item2')");
    
    // Sync the first client
    await stream1.sync();
    
    // Check initial count
    let result = await stream1.query("SELECT COUNT(*) as count FROM items");
    expect(result.rows[0].count).toBe(2);
    
    // Create a second client with the same database
    const client2 = new TributaryClient({
      server: fakeServer,
      db: sharedDb
    });
    
    // Get the same stream for the second client
    const stream2 = await client2.addWriteKey(testPrivateKeyBase64, 'test', 'collection');
    
    // Sync the second client - this should NOT duplicate the data
    await stream2.sync();
    
    // Count should still be 2
    result = await stream2.query("SELECT COUNT(*) as count FROM items");
    expect(result.rows[0].count).toBe(2);
    
    // Add another item via the second client
    await stream2.query("INSERT INTO items VALUES (3, 'item3')");
    
    // Sync again
    await stream2.sync();
    
    // Now we should have 3 items
    result = await stream2.query("SELECT COUNT(*) as count FROM items");
    expect(result.rows[0].count).toBe(3);
    
    // Sync first client again
    await stream1.sync();
    
    // First client should also see 3 items
    result = await stream1.query("SELECT COUNT(*) as count FROM items");
    expect(result.rows[0].count).toBe(3);
  });
});
