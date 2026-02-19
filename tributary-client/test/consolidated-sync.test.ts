// Consolidated Sync Test converted to unit test
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TributaryClient, createTestServer } from '../src/index';
import { PGlite } from '@electric-sql/pglite';
import * as nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';

describe('Consolidated Sync Test', () => {
  let testServer: any;
  let testKeyPair: any;
  let testPrivateKeyBase64: string;

  beforeEach(() => {
    testServer = createTestServer();
    testKeyPair = nacl.sign.keyPair();
    testPrivateKeyBase64 = base64url.encode(Buffer.from(testKeyPair.secretKey));
  });

  it('should sync data between two clients properly', async () => {
    // Create two separate database instances
    const db1 = new PGlite();
    const db2 = new PGlite();

    // Create first client
    const client1 = new TributaryClient({
      server: testServer,
      db: db1
    });
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64);

    // Create second client
    const client2 = new TributaryClient({
      server: testServer,
      db: db2
    });
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64);

    // DB1 creates a table and inserts data
    await stream1.exec("CREATE TABLE IF NOT EXISTS sync_test (id INTEGER PRIMARY KEY, message TEXT, source TEXT)");
    await stream1.exec("INSERT INTO sync_test VALUES (1, 'Hello from DB1', 'DB1')");

    // DB2 syncs to get DB1's schema and data (sync BEFORE writing to avoid skipping blobs)
    await stream2.sync(10000);

    // DB2 should see DB1's data after sync
    const db2QueryResult = await stream2.query("SELECT * FROM sync_test ORDER BY id");
    const hasDB1Data = db2QueryResult.rows.some(row => row.message === 'Hello from DB1');
    expect(hasDB1Data).toBe(true);

    // Insert record from DB2
    await stream2.exec("INSERT INTO sync_test VALUES (2, 'Hello from DB2', 'DB2')");

    // Sync DB1 to get DB2's data
    await stream1.sync(10000);

    // DB1 should see both messages after sync
    const db1QueryResult = await stream1.query("SELECT * FROM sync_test ORDER BY id");
    const hasDB1Record = db1QueryResult.rows.some(row => row.message === 'Hello from DB1');
    const hasDB2Record = db1QueryResult.rows.some(row => row.message === 'Hello from DB2');

    expect(hasDB1Record).toBe(true);
    expect(hasDB2Record).toBe(true);
  });
});
