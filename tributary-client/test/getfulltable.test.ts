// Test for getFullTable functionality in TributaryStream and TributaryLocal
import { describe, it, expect, beforeEach } from 'vitest';
import { TributaryClient, TributaryLocal } from '../src/index';
import { FakeServer } from '../src/fakeServer';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';

describe('getFullTable Method', () => {
  let client: TributaryClient;
  let stream: any;
  let streamId: string;

  beforeEach(async () => {
    const server = new FakeServer();
    client = new TributaryClient({ server });
    
    // Generate a key pair for testing
    const keyPair = nacl.sign.keyPair();
    const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey));
    streamId = base64url.encode(Buffer.from(keyPair.publicKey));
    
    // Add a stream with a write key
    stream = await client.addWriteKey('scribe', privateKeyBase64);
  });

  it('should return fully qualified table name from TributaryStream', async () => {
    // Test getFullTable method on TributaryStream
    const tableName = 'test_table';
    const fullTableName = stream.getFullTable(tableName);
    
    // The result should include the schema name and table name, properly quoted
    expect(fullTableName).toContain('"'); // Should be quoted
    expect(fullTableName).toContain(stream.getSchemaName()); // Should contain schema name
    expect(fullTableName).toContain(tableName); // Should contain table name
  });

  it('should return fully qualified table name from TributaryLocal', async () => {
    // Get a TributaryLocal instance
    const localInstance = await stream.local();
    
    // Test getFullTable method on TributaryLocal
    const tableName = 'another_table';
    const fullTableName = localInstance.getFullTable(tableName);
    
    // The result should include the schema name and table name, properly quoted
    expect(fullTableName).toContain('"'); // Should be quoted
    expect(fullTableName).toContain(stream.getSchemaName()); // Should contain schema name
    expect(fullTableName).toContain(tableName); // Should contain table name
  });

  it('should generate different full table names for different tables', async () => {
    const table1 = 'table_one';
    const table2 = 'table_two';
    
    const fullTable1 = stream.getFullTable(table1);
    const fullTable2 = stream.getFullTable(table2);
    
    // Both should contain the same schema name
    expect(fullTable1).toContain(stream.getSchemaName());
    expect(fullTable2).toContain(stream.getSchemaName());
    
    // But should be different for different table names
    expect(fullTable1).not.toEqual(fullTable2);
  });

  it('should work with the local instance retrieved via getLocal()', async () => {
    // Get a TributaryLocal instance via getLocal
    const localInstance = await client.getLocal('scribe', streamId);
    
    // Ensure we got a valid instance
    expect(localInstance).toBeDefined();
    
    // Test getFullTable method
    const tableName = 'local_test_table';
    const fullTableName = localInstance!.getFullTable(tableName);
    
    // The result should include the schema name and table name, properly quoted
    expect(fullTableName).toContain('"'); // Should be quoted
    expect(fullTableName).toContain(stream.getSchemaName()); // Should contain schema name
    expect(fullTableName).toContain(tableName); // Should contain table name
  });
});
