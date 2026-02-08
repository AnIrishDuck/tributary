// Integration tests for database functions
import { assertEquals, assert } from 'jsr:@std/assert@1';
import { Database } from '../../shared/database.ts';
import { Blob, BlobMetadata, CollectionInfo } from '../../shared/models.ts';

Deno.test('Database initialization works correctly', () => {
  // Test that we can create a Database instance - should always connect to real database now
  const db = new Database(true);
  // Constructor should not throw
  assertEquals(true, true); // Add explicit assertion to avoid leak detection issues
});

Deno.test('Database operations work with real connection', async () => {
  const db = new Database(true);
  
  // Test data
  const testBlob: any = {
    id: 'test-blob-1-' + Date.now(),
    pubkey: 'test-pubkey-' + Date.now(),
    data: new Uint8Array([1, 2, 3, 4]),
    hash: 'test-hash',
    prior_hash: '',
    signature: 'test-signature',
    sequence_number: 1,
    created_at: new Date()
  };
  
  console.log('Attempting to store blob with ID:', testBlob.id);
  
  // Store blob
  const result = await db.storeBlob(testBlob);
  console.log('Store result:', result);
  
  if (!result) {
    console.log('Store operation failed, exiting test');
    assertEquals(result, true);
    return;
  }
  
  // Retrieve blob
  console.log('Attempting to retrieve blob with ID:', testBlob.id);
  const retrieved = await db.retrieveBlob(testBlob.pubkey, testBlob.id);
  console.log('Retrieved blob:', retrieved);
  assert(retrieved !== null);
  if (retrieved) {
    assertEquals(retrieved.id, testBlob.id);
    assertEquals(retrieved.pubkey, testBlob.pubkey);
    assertEquals(retrieved.hash, testBlob.hash);
    assertEquals(retrieved.prior_hash, testBlob.prior_hash);
    assertEquals(retrieved.signature, testBlob.signature);
    assertEquals(retrieved.sequence_number, testBlob.sequence_number);
    
    // Compare data arrays
    const retrievedData = new Uint8Array(retrieved.data);
    assertEquals(retrievedData.length, testBlob.data.length);
    for (let i = 0; i < testBlob.data.length; i++) {
      assertEquals(retrievedData[i], testBlob.data[i]);
    }
  }
  
  // Get collection info
  console.log('Getting collection info for pubkey:', testBlob.pubkey);
  const collectionInfo = await db.getCollectionInfo(testBlob.pubkey);
  console.log('Collection info result:', collectionInfo);
  assertEquals(collectionInfo.blob_count, 1);
  
  // Get latest blob
  console.log('Getting latest blob for pubkey:', testBlob.pubkey);
  const latestBlob = await db.getLatestBlob(testBlob.pubkey);
  console.log('Latest blob result:', latestBlob);
  assert(latestBlob !== null);
  if (latestBlob) {
    assertEquals(latestBlob.id, testBlob.id);
    assertEquals(latestBlob.pubkey, testBlob.pubkey);
    assertEquals(latestBlob.hash, testBlob.hash);
    assertEquals(latestBlob.sequence_number, testBlob.sequence_number);
  }
});

