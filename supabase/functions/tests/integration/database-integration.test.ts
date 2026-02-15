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

Deno.test('Database getAllBlobMetadataPaginated with pagination', async () => {
  const db = new Database(true);
  
  // Create unique pubkey for this test
  const testPubkey = 'test-pubkey-pagination-' + Date.now();
  
  // Store 5 test blobs
  for (let i = 1; i <= 5; i++) {
    const testBlob: any = {
      id: `${testPubkey}:${i}`,
      pubkey: testPubkey,
      data: new Uint8Array([i, i, i]),
      hash: `test-hash-${i}`,
      prior_hash: i === 1 ? '' : `test-hash-${i-1}`,
      signature: `test-signature-${i}`,
      sequence_number: i,
      created_at: new Date()
    };
    
    const result = await db.storeBlob(testBlob);
    assert(result, `Failed to store blob ${i}`);
  }
  
  console.log('Stored 5 blobs for pagination test');
  
  // Test 1: Get all blobs (no filter, no max)
  console.log('Test 1: Get all blobs');
  let result = await db.getAllBlobMetadataPaginated(testPubkey);
  console.log(`Result: ${result.blobs.length} blobs, total_count: ${result.total_count}`);
  assertEquals(result.blobs.length, 5);
  assertEquals(result.total_count, 5);
  
  // Test 2: Get blobs with startSequence=1, max=2 (should get blobs 2,3 - AFTER sequence 1)
  console.log('Test 2: Get blobs with startSequence=1, max=2');
  result = await db.getAllBlobMetadataPaginated(testPubkey, 1, 2);
  console.log(`Result: ${result.blobs.length} blobs, sequences: [${result.blobs.map(b => b.sequence_number).join(', ')}]`);
  assertEquals(result.blobs.length, 2, 'Should get exactly 2 blobs');
  assertEquals(result.total_count, 5, 'Total count should be 5');
  assertEquals(result.blobs[0].sequence_number, 2, 'First blob should be sequence 2 (AFTER 1)');
  assertEquals(result.blobs[1].sequence_number, 3, 'Second blob should be sequence 3');
  
  // Test 3: Get blobs with startSequence=3, max=10 (should get blobs 4,5 - AFTER sequence 3)
  console.log('Test 3: Get blobs with startSequence=3, max=10');
  result = await db.getAllBlobMetadataPaginated(testPubkey, 3, 10);
  console.log(`Result: ${result.blobs.length} blobs, sequences: [${result.blobs.map(b => b.sequence_number).join(', ')}]`);
  assertEquals(result.blobs.length, 2, 'Should get exactly 2 blobs (AFTER 3)');
  assertEquals(result.total_count, 5, 'Total count should be 5');
  assertEquals(result.blobs[0].sequence_number, 4, 'First blob should be sequence 4 (AFTER 3)');
  assertEquals(result.blobs[1].sequence_number, 5, 'Second blob should be sequence 5');
  
  // Test 4: Get blobs with startSequence=6 (should get 0 blobs since max sequence is 5)
  console.log('Test 4: Get blobs with startSequence=6');
  result = await db.getAllBlobMetadataPaginated(testPubkey, 6, 10);
  console.log(`Result: ${result.blobs.length} blobs`);
  assertEquals(result.blobs.length, 0, 'Should get 0 blobs when startSequence is beyond available data');
  assertEquals(result.total_count, 5, 'Total count should still be 5');
  
  console.log('Database getAllBlobMetadataPaginated test passed successfully');
});

