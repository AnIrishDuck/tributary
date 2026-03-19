// Test for the local() method in TributaryStream
import { describe, it, expect, beforeEach } from 'vitest';
import { TributaryClient, createTestServer, createTestClient } from '../src/index';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';

describe('TributaryStream - local() Method', () => {
  let client: TributaryClient;
  let stream: any;

  beforeEach(async () => {
    const server = createTestServer();
    client = await createTestClient({ server });
    
    // Generate a key pair for testing
    const keyPair = nacl.sign.keyPair();
    const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey));
    
    // Add a stream with a write key
    stream = await client.addWriteKey('scribe', privateKeyBase64);
  });

  it('should return a PGLite instance with the correct search path set', async () => {
    // Get the local database instance
    const localDB = await stream.local();
    
    // Verify it's a PGLite instance by checking for expected methods
    expect(localDB).toBeDefined();
    expect(typeof localDB.query).toBe('function');
    expect(typeof localDB.exec).toBe('function');
    
    // Test that we can execute a query using the local instance
    await localDB.exec('CREATE TABLE IF NOT EXISTS test_table (id INTEGER, name TEXT)');
    await localDB.exec("INSERT INTO test_table VALUES (1, 'test')");
    
    // Verify the schema is correct
    const schema = await localDB.query('SELECT current_schema() AS schema');
    expect(schema.rows).toHaveLength(1);
    expect(schema.rows[0]).toEqual({ schema: localDB.schemaName });

    // Query using the local database (which has the correct search path set)
    const result = await localDB.query('SELECT * FROM test_table');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ id: 1, name: 'test' });

    // Query using the local database (which has the correct search path set)
    const globalResult = await localDB.query(`SELECT * FROM ${localDB.getFullTable('test_table')}`);
    expect(globalResult.rows).toHaveLength(1);
    expect(globalResult.rows[0]).toEqual({ id: 1, name: 'test' });
  });

  it('should set the search path to include the stream\'s schema', async () => {
    // Get the local database instance (this should set the search path)
    const localDB = await stream.local();
    
    // Execute multiple operations in the same session to verify the search path is set
    await localDB.exec('CREATE TABLE test_schema_table (id INTEGER PRIMARY KEY, value TEXT)');
    await localDB.exec("INSERT INTO test_schema_table VALUES (1, 'schema test')");
    
    // Query the data in the same session
    const result = await localDB.query('SELECT * FROM test_schema_table');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ id: 1, value: 'schema test' });
  });
});
