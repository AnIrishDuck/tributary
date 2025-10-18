// Test for the getLocal() method in TributaryClient and TributaryLocal functionality
import { describe, it, expect, beforeEach } from 'vitest';
import { TributaryClient, TributaryLocal } from '../src/index';
import { FakeServer } from '../src/fakeServer';
import nacl from 'tweetnacl';

describe('TributaryClient - getLocal() Method', () => {
  let client: TributaryClient;
  let stream: any;
  let streamId: string;

  beforeEach(async () => {
    const server = new FakeServer();
    client = new TributaryClient({ server });
    
    // Generate a key pair for testing
    const keyPair = nacl.sign.keyPair();
    const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');
    streamId = Buffer.from(keyPair.publicKey).toString('base64');
    
    // Add a stream with a write key
    stream = await client.addWriteKey('scribe', privateKeyBase64);
  });

  it('should return a PGLite instance when calling getLocal on an existing stream', async () => {
    // Get the local database instance using getLocal
    const localDB = await client.getLocal(streamId);
    
    // Verify it's a PGLite instance by checking for expected methods
    expect(localDB).toBeDefined();
    expect(typeof localDB.query).toBe('function');
    expect(typeof localDB.exec).toBe('function');
    
    // Test that we can execute a query using the local instance
    await localDB.exec('CREATE TABLE IF NOT EXISTS test_getlocal_table (id INTEGER, name TEXT)');
    await localDB.exec("INSERT INTO test_getlocal_table VALUES (1, 'getLocal test')");
    
    const result = await localDB.query('SELECT * FROM test_getlocal_table');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ id: 1, name: 'getLocal test' });
  });

  it('should return undefined for a non-existent stream ID', async () => {
    // Try to get a local database instance for a non-existent stream
    const nonExistentId = 'non-existent-stream-id';
    const localDB = await client.getLocal(nonExistentId);
    
    // Should return undefined
    expect(localDB).toBeUndefined();
  });
});

describe('TributaryLocal Class', () => {
  let client: TributaryClient;
  let stream: any;
  let localInstance: TributaryLocal;

  beforeEach(async () => {
    const server = new FakeServer();
    client = new TributaryClient({ server });
    
    // Generate a key pair for testing
    const keyPair = nacl.sign.keyPair();
    const privateKeyBase64 = Buffer.from(keyPair.secretKey).toString('base64');
    
    // Add a stream with a write key
    stream = await client.addWriteKey('scribe', privateKeyBase64);
    
    // Get a TributaryLocal instance (for testing the class methods)
    // We need to create it directly since it's mainly used internally
    localInstance = new TributaryLocal(stream.pglite, stream.getSchemaName());
  });

  it('should execute query method correctly', async () => {
    // Test the query method
    await localInstance.exec('CREATE TABLE IF NOT EXISTS test_local_query (id INTEGER, value TEXT)');
    await localInstance.exec("INSERT INTO test_local_query VALUES (1, 'local query test')");
    
    const result = await localInstance.query('SELECT * FROM test_local_query');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ id: 1, value: 'local query test' });
  });

  it('should execute exec method correctly', async () => {
    // Test the exec method
    await localInstance.exec('CREATE TABLE IF NOT EXISTS test_local_exec (id INTEGER, value TEXT)');
    await localInstance.exec("INSERT INTO test_local_exec VALUES (1, 'local exec test')");
    
    // Verify the data was inserted by querying it
    const db = await stream.local();
    const result = await db.query('SELECT * FROM test_local_exec');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ id: 1, value: 'local exec test' });
  });

  it('should execute transaction method correctly', async () => {
    // Test the transaction method
    const result = await localInstance.transaction(async (tx: any) => {
      await tx.exec('CREATE TABLE IF NOT EXISTS test_local_transaction (id INTEGER, value TEXT)');
      await tx.exec("INSERT INTO test_local_transaction VALUES (1, 'transaction test')");
      
      const queryResult = await tx.query('SELECT * FROM test_local_transaction');
      return queryResult.rows;
    });
    
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: 1, value: 'transaction test' });
  });
});
