// Integration tests for tributary-fn API endpoints
import { assert, assertEquals } from 'jsr:@std/assert@1';
import util from 'tweetnacl-util';
import nacl from 'tweetnacl';
import { Database } from '../../shared/database.ts';
import { verifySignature, computeChainHash, computeHash } from '../../shared/crypto.ts';
import { Blob } from '../../shared/models.ts';

const { encodeBase64 } = util;

// Helper function to generate a test signature
function generateTestSignature(data: Uint8Array, keyPair: nacl.SignKeyPair): string {
  const signature = nacl.sign.detached(data, keyPair.secretKey);
  return encodeBase64(signature);
}

// Database configuration for testing
const DATABASE_URL = Deno.env.get('DATABASE_URL') || 'postgresql://postgres:your-super-secret-and-long-postgres-password@supabase-db:5432/postgres';

Deno.test('Database operations work correctly with real connection', async () => {
  // Connect to the actual database
  const db = new Database(DATABASE_URL);
  
  // Test collection info for non-existent collection
  const testPubkey = 'test_pubkey_db_ops_' + Date.now();
  const collectionInfo = await db.getCollectionInfo(testPubkey);
  assertEquals(collectionInfo.blob_count, 0);
  assertEquals(collectionInfo.first_blob_timestamp, null);
  assertEquals(collectionInfo.last_blob_timestamp, null);
  
  console.log('Database operations test completed successfully with real connection');
  assertEquals(true, true);
});

Deno.test('Database connection test with DATABASE_URL', async () => {
  // Just test that we can create the Database instance without error
  const db = new Database(DATABASE_URL);
});

Deno.test('Full upload -> retrieve flow test', async () => {
  // Connect to the actual database
  const db = new Database(DATABASE_URL);
  
  // Generate test key pair
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeBase64(keyPair.publicKey);
  const testPubkey = encodedPubkey + '_flow_test_' + Date.now();
  
  try {
    // Test data for first blob
    const firstData = new TextEncoder().encode('First blob data for full flow test');
    const firstChainHash = await computeChainHash('', firstData);
    
    // Generate signature for the first chain hash
    const firstHashBytes = new TextEncoder().encode(firstChainHash);
    const firstSignature = generateTestSignature(firstHashBytes, keyPair);
    
    // Verify signature works correctly
    const firstSigValid = await verifySignature(testPubkey, firstSignature, firstHashBytes);
    assertEquals(firstSigValid, true);
    
    // Create a blob object to store
    const firstBlob: any = {
      id: `${testPubkey}:1`,
      pubkey: testPubkey,
      data: firstData,
      hash: firstChainHash,
      prior_hash: '',
      signature: firstSignature,
      sequence_number: 1,
      created_at: new Date()
    };
    
    // Store the blob directly using database (simulating what upload function does)
    const stored = await db.storeBlob(firstBlob);
    assertEquals(stored, true);
    
    // Retrieve the blob
    const retrievedBlob = await db.retrieveBlob(testPubkey, `${testPubkey}:1`);
    assert(retrievedBlob !== null);
    if (retrievedBlob) {
      assertEquals(retrievedBlob.id, `${testPubkey}:1`);
      assertEquals(retrievedBlob.pubkey, testPubkey);
      assertEquals(retrievedBlob.hash, firstChainHash);
      assertEquals(retrievedBlob.prior_hash, '');
      assertEquals(retrievedBlob.sequence_number, 1);
      
      // Verify the data is the same
      const retrievedData = new Uint8Array(retrievedBlob.data);
      assertEquals(retrievedData.length, firstData.length);
      for (let i = 0; i < firstData.length; i++) {
        assertEquals(retrievedData[i], firstData[i]);
      }
    }
    
    // Test getCollectionInfo
    const collectionInfo = await db.getCollectionInfo(testPubkey);
    assertEquals(collectionInfo.blob_count, 1);
    
    // Test getLatestBlob
    const latestBlob = await db.getLatestBlob(testPubkey);
    assert(latestBlob !== null);
    if (latestBlob) {
      assertEquals(latestBlob.id, `${testPubkey}:1`);
      assertEquals(latestBlob.pubkey, testPubkey);
      assertEquals(latestBlob.hash, firstChainHash);
      assertEquals(latestBlob.sequence_number, 1);
    }
    
    console.log('Full upload -> retrieve flow test completed successfully');
    assertEquals(true, true);
  } catch (error) {
    console.error('Full flow test failed:', error);
    throw error;
  }
});

Deno.test('Upload function logic test with chaining', async () => {
  const db = new Database(DATABASE_URL);
  
  // Generate test key pair
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeBase64(keyPair.publicKey);
  const testPubkey = encodedPubkey + '_upload_test_' + Date.now();
  
  try {
    // Test data for first blob
    const firstData = new TextEncoder().encode('First blob for upload test');
    const firstChainHash = await computeChainHash('', firstData);
    
    // Generate signature for the first chain hash
    const firstHashBytes = new TextEncoder().encode(firstChainHash);
    const firstSignature = generateTestSignature(firstHashBytes, keyPair);
    
    // Verify signature works correctly
    const firstSigValid = await verifySignature(testPubkey, firstSignature, firstHashBytes);
    assertEquals(firstSigValid, true);
    
    // Test the full upload logic by simulating what the handleUpload function does
    // First, check that there's no previous blob (empty chain)
    const latestBlob = await db.getLatestBlob(testPubkey);
    assertEquals(latestBlob, null);
    
    // Create the expected blob data structure
    const blobToStore: any = {
      id: `${testPubkey}:1`,
      pubkey: testPubkey,
      data: firstData,
      hash: firstChainHash,
      prior_hash: '', // No prior hash for first blob
      signature: firstSignature,
      sequence_number: 1,
      created_at: new Date()
    };
    
    // Store the blob
    const stored = await db.storeBlob(blobToStore);
    assertEquals(stored, true);
    
    // Now test uploading a second blob in the chain
    const secondData = new TextEncoder().encode('Second blob for upload test');
    const secondChainHash = await computeChainHash(firstChainHash, secondData);
    
    // Generate signature for the second chain hash
    const secondHashBytes = new TextEncoder().encode(secondChainHash);
    const secondSignature = generateTestSignature(secondHashBytes, keyPair);
    
    // Verify second signature works correctly
    const secondSigValid = await verifySignature(testPubkey, secondSignature, secondHashBytes);
    assertEquals(secondSigValid, true);
    
    // Create the second blob data structure
    const secondBlobToStore: any = {
      id: `${testPubkey}:2`,
      pubkey: testPubkey,
      data: secondData,
      hash: secondChainHash,
      prior_hash: firstChainHash, // Prior hash is the first blob's hash
      signature: secondSignature,
      sequence_number: 2,
      created_at: new Date()
    };
    
    // Store the second blob
    const secondStored = await db.storeBlob(secondBlobToStore);
    assertEquals(secondStored, true);
    
    // Verify we now have 2 blobs in the collection
    const collectionInfo = await db.getCollectionInfo(testPubkey);
    assertEquals(collectionInfo.blob_count, 2);
    
    // Verify the latest blob is the second one
    const latestBlobAfterSecond = await db.getLatestBlob(testPubkey);
    assert(latestBlobAfterSecond !== null);
    if (latestBlobAfterSecond) {
      assertEquals(latestBlobAfterSecond.id, `${testPubkey}:2`);
      assertEquals(latestBlobAfterSecond.pubkey, testPubkey);
      assertEquals(latestBlobAfterSecond.hash, secondChainHash);
      assertEquals(latestBlobAfterSecond.sequence_number, 2);
      assertEquals(latestBlobAfterSecond.prior_hash, firstChainHash);
    }
    
    console.log('Upload function logic test with chaining completed successfully');
    assertEquals(true, true);
  } catch (error) {
    console.error('Upload function logic test failed:', error);
    throw error;
  }
});

Deno.test('Crypto functions work correctly', async () => {
  // Test signature verification
  const keyPair = nacl.sign.keyPair();
  const testData = new TextEncoder().encode('Test data for signing');
  const signature = generateTestSignature(testData, keyPair);
  const encodedPubkey = encodeBase64(keyPair.publicKey);
  
  // Verify the signature
  const isValid = await verifySignature(encodedPubkey, signature, testData);
  assertEquals(isValid, true);
  
  // Test hash computation
  const testString = 'Hello, Tributary!';
  const testDataBytes = new TextEncoder().encode(testString);
  const hash = await computeHash(testDataBytes);
  
  // Known hash value for "Hello, Tributary!"
  assertEquals(hash, '692f392e53f691be69dd1e502ef474a9103a19a48ef7a0a9115ee83d3a4bcb57');
  
  // Test chain hash computation
  const priorHash = '';
  const chainHash = await computeChainHash(priorHash, testDataBytes);
  
  // Actual computed chain hash value for "Hello, Tributary!" with empty prior
  assertEquals(chainHash, '5204cefdb2bf972bb7c7a47c37176e3d8c9e658ee89984ec66afb1b7040349a9');
  
  console.log('Crypto functions test completed successfully');
});

Deno.test('Chaining functionality test', async () => {
  // Test the chaining functionality by creating multiple blobs in sequence
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeBase64(keyPair.publicKey);
  
  // Test data for first blob
  const firstData = new TextEncoder().encode('First blob data in chain');
  const firstBodyHash = await computeHash(firstData);
  const firstChainHash = await computeChainHash('', firstData);
  
  // Generate signature for the first chain hash
  const firstHashBytes = new TextEncoder().encode(firstChainHash);
  const firstSignature = generateTestSignature(firstHashBytes, keyPair);
  
  // Verify signature works correctly
  const firstSigValid = await verifySignature(encodedPubkey, firstSignature, firstHashBytes);
  assertEquals(firstSigValid, true);
  
  // Test chain hash computation - using actual computed values
  assertEquals(firstBodyHash, '6c3b602c924c6add56020db472abf3217e2fce267c7b254de048016eb800825c');
  assertEquals(firstChainHash, 'e8b833d5219172f95fb0867b2704d3232b9da998c88de37a4ea5b9a91048a580');
  
  // Test data for second blob (demonstrating chaining)
  const secondData = new TextEncoder().encode('Second blob data in chain');
  const secondBodyHash = await computeHash(secondData);
  const secondChainHash = await computeChainHash(firstChainHash, secondData);
  
  // Generate signature for the second chain hash
  const secondHashBytes = new TextEncoder().encode(secondChainHash);
  const secondSignature = generateTestSignature(secondHashBytes, keyPair);
  
  // Verify second signature
  const secondSigValid = await verifySignature(encodedPubkey, secondSignature, secondHashBytes);
  assertEquals(secondSigValid, true);
  
  // These should match the actual computed values
  assertEquals(secondBodyHash, '3f2bab3b69a3f391324c1ee2626862891c8148aa7b053d794fb3e3150f6c2f80');
  assertEquals(secondChainHash, 'fe08784212413245d90d923053030959dabdc78cc218e6d6ad428e44402d94c7');
  
  console.log('Chaining functionality test completed successfully');
});

Deno.test('Error handling scenarios', async () => {
  // Test error handling in crypto functions
  const invalidPubkey = 'invalid_base64!!!'; // Invalid base64
  const testData = new TextEncoder().encode('test data');
  const invalidSignature = 'invalid_signature!!!'; // Invalid base64
  
  // This should not throw but return false
  const result = await verifySignature(invalidPubkey, invalidSignature, testData);
  assertEquals(result, false);
  
  console.log('Error handling test completed successfully');
});
