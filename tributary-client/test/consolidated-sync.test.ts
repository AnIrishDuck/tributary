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
  let collectionId: string;

  beforeEach(() => {
    testServer = createTestServer();
    testKeyPair = nacl.sign.keyPair();
    testPrivateKeyBase64 = base64url.encode(Buffer.from(testKeyPair.secretKey));
    collectionId = 'consolidated_test_' + Date.now(); // Use underscore instead of dash
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
    
    // Add a stream to work with
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64);

    // Create second client
    const client2 = new TributaryClient({
      server: testServer,
      db: db2
    });
    
    // Add a stream to work with
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64);

    console.log('=== Test Phase 1: Initialize DB1 and create schema ===');
    // Create table in DB1
    await stream1.exec("CREATE TABLE IF NOT EXISTS sync_test (id INTEGER PRIMARY KEY, message TEXT, source TEXT, timestamp TEXT)");
    
    console.log('=== Test Phase 2: Insert initial data from DB1 ===');
    // Insert first record from DB1
    await stream1.exec("INSERT INTO sync_test VALUES (1, 'Hello from DB1', 'DB1', '" + new Date().toISOString() + "')");

    console.log('=== Test Phase 3: Verify DB2 can read DB1\'s data ===');
    // Create table in DB2 (schema needs to exist locally)
    await stream2.exec("CREATE TABLE IF NOT EXISTS sync_test (id INTEGER PRIMARY KEY, message TEXT, source TEXT, timestamp TEXT)");
    
    // Sync DB2 to get DB1's data
    await stream2.sync(10000);
    
    // Query data in DB2 (should see DB1's message after sync)
    const db2QueryResult = await stream2.query("SELECT * FROM sync_test ORDER BY id");
    console.log('DB2 query result:', db2QueryResult.rows);
    
    // Check if DB2 sees DB1's data
    const hasDB1Data = db2QueryResult.rows.some(row => row.message === 'Hello from DB1');
    if (hasDB1Data) {
      console.log('[VALIDATION] ✓ DB2 successfully read DB1\'s data');
    } else {
      console.log('[VALIDATION] ✗ DB2 did not find DB1\'s data');
      console.log('[VALIDATION] Full result was:', db2QueryResult.rows);
    }

    console.log('=== Test Phase 4: Insert data from DB2 ===');
    // Insert record from DB2
    await stream2.exec("INSERT INTO sync_test VALUES (2, 'Hello from DB2', 'DB2', '" + new Date().toISOString() + "')");

    console.log('=== Test Phase 5: Verify DB1 can read DB2\'s data ===');
    // Sync DB1 to get DB2's data
    await stream1.sync(10000);
    
    // Query data in DB1 (should see both messages after sync)
    const db1QueryResult = await stream1.query("SELECT * FROM sync_test ORDER BY id");
    console.log('DB1 query result:', db1QueryResult.rows);

    console.log('=== Final Validation ===');
    let recordsFound = 0;
    const hasDB1Record = db1QueryResult.rows.some(row => row.message === 'Hello from DB1');
    const hasDB2Record = db1QueryResult.rows.some(row => row.message === 'Hello from DB2');
    
    if (hasDB1Record) {
      console.log('[VALIDATION] ✓ DB1 reads its own data');
      recordsFound++;
    } else {
      console.log('[VALIDATION] ✗ DB1 missing its own data');
    }

    if (hasDB2Record) {
      console.log('[VALIDATION] ✓ DB1 reads DB2 data');
      recordsFound++;
    } else {
      console.log('[VALIDATION] ✗ DB1 missing DB2 data');
    }

    expect(recordsFound).toBe(2);
    console.log('Both databases synchronized successfully');
  });
});
