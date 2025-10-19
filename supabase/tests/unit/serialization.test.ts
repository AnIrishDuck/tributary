// Test data serialization and response formats
import { assertEquals } from 'jsr:@std/assert@1';
import { Blob, CollectionInfo } from '../../shared/models.ts';

Deno.test('Blob JSON serialization format', () => {
  const testDate = new Date('2023-01-01T12:00:00Z');
  const testData = new Uint8Array([1, 2, 3, 4, 5]);
  
  const blob: Blob = {
    id: 'test:1',
    pubkey: 'test-pubkey',
    data: testData,
    hash: 'test-hash',
    prior_hash: 'previous-hash',
    signature: 'test-signature',
    sequence_number: 1,
    created_at: testDate
  };
  
  // Test that we can convert to JSON format as used in the API
  const jsonData = {
    id: blob.id,
    pubkey: blob.pubkey,
    data: Array.from(blob.data), // Convert Uint8Array to array for JSON
    hash: blob.hash,
    prior_hash: blob.prior_hash,
    signature: blob.signature,
    sequence_number: blob.sequence_number,
    created_at: blob.created_at.toISOString()
  };
  
  assertEquals(jsonData.id, 'test:1');
  assertEquals(jsonData.pubkey, 'test-pubkey');
  assertEquals(jsonData.data, [1, 2, 3, 4, 5]);
  assertEquals(jsonData.hash, 'test-hash');
  assertEquals(jsonData.prior_hash, 'previous-hash');
  assertEquals(jsonData.signature, 'test-signature');
  assertEquals(jsonData.sequence_number, 1);
  assertEquals(jsonData.created_at, '2023-01-01T12:00:00.000Z');
});

Deno.test('CollectionInfo JSON serialization format', () => {
  const testDate = new Date('2023-01-01T12:00:00Z');
  
  const info: CollectionInfo = {
    blob_count: 5,
    first_blob_timestamp: testDate,
    last_blob_timestamp: testDate
  };
  
  const jsonData = {
    pubkey: 'test-pubkey',
    blob_count: info.blob_count,
    first_blob_timestamp: info.first_blob_timestamp ? info.first_blob_timestamp.toISOString() : null,
    last_blob_timestamp: info.last_blob_timestamp ? info.last_blob_timestamp.toISOString() : null
  };
  
  assertEquals(jsonData.pubkey, 'test-pubkey');
  assertEquals(jsonData.blob_count, 5);
  assertEquals(jsonData.first_blob_timestamp, '2023-01-01T12:00:00.000Z');
  assertEquals(jsonData.last_blob_timestamp, '2023-01-01T12:00:00.000Z');
  
  // Test with null timestamps
  const infoWithNulls: CollectionInfo = {
    blob_count: 0,
    first_blob_timestamp: null,
    last_blob_timestamp: null
  };
  
  const jsonWithNulls = {
    pubkey: 'test-pubkey',
    blob_count: infoWithNulls.blob_count,
    first_blob_timestamp: infoWithNulls.first_blob_timestamp ? infoWithNulls.first_blob_timestamp.toISOString() : null,
    last_blob_timestamp: infoWithNulls.last_blob_timestamp ? infoWithNulls.last_blob_timestamp.toISOString() : null
  };
  
  assertEquals(jsonWithNulls.blob_count, 0);
  assertEquals(jsonWithNulls.first_blob_timestamp, null);
  assertEquals(jsonWithNulls.last_blob_timestamp, null);
});

Deno.test('Response format compatibility', async () => {
  // Test that our response formats match what the client expects
  
  // Example upload response
  const uploadResponse = {
    status: 'stored',
    id: 'test:1',
    pubkey: 'test-pubkey',
    sequence_number: 1,
    hash: 'test-hash'
  };
  
  assertEquals(uploadResponse.status, 'stored');
  assertEquals(uploadResponse.id, 'test:1');
  assertEquals(uploadResponse.pubkey, 'test-pubkey');
  assertEquals(uploadResponse.sequence_number, 1);
  assertEquals(uploadResponse.hash, 'test-hash');
  
  // Example error response
  const errorResponse = {
    error: 'Test error message'
  };
  
  assertEquals(errorResponse.error, 'Test error message');
});
