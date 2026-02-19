// Test for route handler with in-memory database
import { assert, assertEquals } from 'jsr:@std/assert@1';
import util from 'tweetnacl-util';
import nacl from 'tweetnacl';
import { FakeDatabase } from '../../shared/fake-database.ts';
import { createRouteHandler, Authenticator } from '../../shared/routes.ts';
import { verifySignature, computeChainHash, encodeUrlBase64 } from '../../shared/crypto.ts';

// Fake authenticator for tests — always returns a fixed test user ID
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const fakeAuthenticator: Authenticator = async (_req) => ({ userId: TEST_USER_ID });

// Helper function to generate a test signature
function generateTestSignature(data: Uint8Array, keyPair: nacl.SignKeyPair): string {
  const signature = nacl.sign.detached(data, keyPair.secretKey);
  return encodeUrlBase64(signature);
}

// Helper function to create a fake request
function createFakeRequest(url: string, options: { method?: string; headers?: Record<string, string>; body?: Uint8Array } = {}): Request {
  const { method = 'GET', headers = {}, body } = options;
  
  // Create a Request object with the specified parameters
  // For Supabase functions, the path structure is /functions/v1/stream/[rest of path]
  return new Request(`http://localhost:54321/functions/v1/stream${url}`, {
    method,
    headers,
    body: body ? body.buffer as ArrayBuffer : undefined
  });
}

// Helper function to create a properly URL-encoded path for base64 pubkeys
function createEncodedPath(pubkey: string, endpoint?: string): string {
  // Use the URL-safe base64 encoded pubkey directly
  const urlSafePubkey = pubkey;
  if (endpoint) {
    // Also convert endpoint to URL-safe if it contains base64
    const urlSafeEndpoint = endpoint.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    return `/${urlSafePubkey}/${urlSafeEndpoint}`;
  }
  return `/${urlSafePubkey}`;
}

Deno.test('Route handler with fake database: Health endpoint', async () => {
  // Create a fake database instance
  const db = new FakeDatabase();
  const handler = createRouteHandler(db as any, fakeAuthenticator); // Cast to any to avoid type issues
  
  // Create a fake request for the health endpoint
  const request = createFakeRequest('/health');
  const response = await handler(request);
  
  assertEquals(response.status, 200);
  
  const body = await response.json();
  assertEquals(body.status, 'healthy');
  assertEquals(body.service, 'tributary-fn');
});

Deno.test('Route handler with fake database: Complete flow test', async () => {
  // Create a fake database instance
  const db = new FakeDatabase();
  const handler = createRouteHandler(db as any, fakeAuthenticator); // Cast to any to avoid type issues
  
  // Generate test key pair
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeUrlBase64(keyPair.publicKey);
  const testPubkey = encodedPubkey;
  
  try {
    // 1. Test initial collection info (should be empty)
    const initialInfoRequest = createFakeRequest(createEncodedPath(testPubkey, 'info'));
    const initialInfoResponse = await handler(initialInfoRequest);
    assertEquals(initialInfoResponse.status, 200);
    
    const initialInfoBody = await initialInfoResponse.json();
    assertEquals(initialInfoBody.blob_count, 0);
    assertEquals(initialInfoBody.first_blob_timestamp, null);
    assertEquals(initialInfoBody.last_blob_timestamp, null);
    
    // 2. Test initial latest blob (should return 404)
    const initialLatestRequest = createFakeRequest(createEncodedPath(testPubkey, 'latest'));
    const initialLatestResponse = await handler(initialLatestRequest);
    assertEquals(initialLatestResponse.status, 404);
    
    // 3. Create and store first blob
    const firstData = new TextEncoder().encode('First blob in complete flow test');
    const firstChainHash = await computeChainHash('', firstData);
    
    // Generate signature for the first chain hash
    const firstHashBytes = new TextEncoder().encode(firstChainHash);
    const firstSignature = generateTestSignature(firstHashBytes, keyPair);
    
    // Test storing a blob via the route handler
    const storeRequest = createFakeRequest(createEncodedPath(testPubkey), {
      method: 'POST',
      headers: {
        'X-Tributary-Hash': firstChainHash,
        'X-Tributary-Authorization': firstSignature
      },
      body: firstData
    });
    
    const storeResponse = await handler(storeRequest);
    assertEquals(storeResponse.status, 200);
    
    const storeResponseBody = await storeResponse.json();
    assertEquals(storeResponseBody.status, 'stored');
    assertEquals(storeResponseBody.id, `${testPubkey}:1`);
    assertEquals(storeResponseBody.pubkey, testPubkey);
    assertEquals(storeResponseBody.sequence_number, 1);
    assertEquals(storeResponseBody.hash, firstChainHash);
    
    // 4. Verify collection info after first blob
    const infoAfterFirstRequest = createFakeRequest(createEncodedPath(testPubkey, 'info'));
    const infoAfterFirstResponse = await handler(infoAfterFirstRequest);
    assertEquals(infoAfterFirstResponse.status, 200);
    
    const infoAfterFirstBody = await infoAfterFirstResponse.json();
    assertEquals(infoAfterFirstBody.blob_count, 1);
    assert(infoAfterFirstBody.first_blob_timestamp !== null);
    assertEquals(infoAfterFirstBody.first_blob_timestamp, infoAfterFirstBody.last_blob_timestamp);
    
    // 5. Verify latest blob is the first one
    const latestAfterFirstRequest = createFakeRequest(createEncodedPath(testPubkey, 'latest'));
    const latestAfterFirstResponse = await handler(latestAfterFirstRequest);
    assertEquals(latestAfterFirstResponse.status, 200);
    
    const latestAfterFirstBody = await latestAfterFirstResponse.json();
    assertEquals(latestAfterFirstBody.id, `${testPubkey}:1`);
    assertEquals(latestAfterFirstBody.pubkey, testPubkey);
    assertEquals(latestAfterFirstBody.hash, firstChainHash);
    assertEquals(latestAfterFirstBody.sequence_number, 1);
    assertEquals(latestAfterFirstBody.prior_hash, '');
    
    // 6. Retrieve the first blob
    const retrieveFirstRequest = createFakeRequest(createEncodedPath(testPubkey, "1"));
    const retrieveFirstResponse = await handler(retrieveFirstRequest);
    assertEquals(retrieveFirstResponse.status, 200);
    
    const retrieveFirstBody = await retrieveFirstResponse.json();
    assertEquals(retrieveFirstBody.id, `${testPubkey}:1`);
    assertEquals(retrieveFirstBody.pubkey, testPubkey);
    assertEquals(retrieveFirstBody.hash, firstChainHash);
    assertEquals(retrieveFirstBody.prior_hash, '');
    assertEquals(retrieveFirstBody.sequence_number, 1);
    
    // Verify the data is the same
    const retrievedData = new Uint8Array(retrieveFirstBody.data);
    assertEquals(retrievedData.length, firstData.length);
    for (let i = 0; i < firstData.length; i++) {
      assertEquals(retrievedData[i], firstData[i]);
    }
    
    // 7. Create and store second blob (chained)
    const secondData = new TextEncoder().encode('Second blob in complete flow test');
    const secondChainHash = await computeChainHash(firstChainHash, secondData);
    
    // Generate signature for the second chain hash
    const secondHashBytes = new TextEncoder().encode(secondChainHash);
    const secondSignature = generateTestSignature(secondHashBytes, keyPair);
    
    // Test storing the second blob via the route handler
    const storeSecondRequest = createFakeRequest(createEncodedPath(testPubkey), {
      method: 'POST',
      headers: {
        'X-Tributary-Hash': secondChainHash,
        'X-Tributary-Authorization': secondSignature
      },
      body: secondData
    });
    
    const storeSecondResponse = await handler(storeSecondRequest);
    assertEquals(storeSecondResponse.status, 200);
    
    const storeSecondResponseBody = await storeSecondResponse.json();
    assertEquals(storeSecondResponseBody.status, 'stored');
    assertEquals(storeSecondResponseBody.id, `${testPubkey}:2`);
    assertEquals(storeSecondResponseBody.pubkey, testPubkey);
    assertEquals(storeSecondResponseBody.sequence_number, 2);
    assertEquals(storeSecondResponseBody.hash, secondChainHash);
    
    // 8. Verify collection info after second blob
    const infoAfterSecondRequest = createFakeRequest(createEncodedPath(testPubkey, 'info'));
    const infoAfterSecondResponse = await handler(infoAfterSecondRequest);
    assertEquals(infoAfterSecondResponse.status, 200);
    
    const infoAfterSecondBody = await infoAfterSecondResponse.json();
    assertEquals(infoAfterSecondBody.blob_count, 2);
    assert(infoAfterSecondBody.first_blob_timestamp !== null);
    assert(infoAfterSecondBody.last_blob_timestamp !== null);
    assert(infoAfterSecondBody.first_blob_timestamp !== infoAfterSecondBody.last_blob_timestamp);
    
    // 9. Verify latest blob is the second one
    const latestAfterSecondRequest = createFakeRequest(createEncodedPath(testPubkey, 'latest'));
    const latestAfterSecondResponse = await handler(latestAfterSecondRequest);
    assertEquals(latestAfterSecondResponse.status, 200);
    
    const latestAfterSecondBody = await latestAfterSecondResponse.json();
    assertEquals(latestAfterSecondBody.id, `${testPubkey}:2`);
    assertEquals(latestAfterSecondBody.pubkey, testPubkey);
    assertEquals(latestAfterSecondBody.hash, secondChainHash);
    assertEquals(latestAfterSecondBody.sequence_number, 2);
    assertEquals(latestAfterSecondBody.prior_hash, firstChainHash);
    
    // 10. Retrieve the second blob
    const retrieveSecondRequest = createFakeRequest(createEncodedPath(testPubkey, "2"));
    const retrieveSecondResponse = await handler(retrieveSecondRequest);
    assertEquals(retrieveSecondResponse.status, 200);
    
    const retrieveSecondBody = await retrieveSecondResponse.json();
    assertEquals(retrieveSecondBody.id, `${testPubkey}:2`);
    assertEquals(retrieveSecondBody.pubkey, testPubkey);
    assertEquals(retrieveSecondBody.hash, secondChainHash);
    assertEquals(retrieveSecondBody.sequence_number, 2);
    assertEquals(retrieveSecondBody.prior_hash, firstChainHash);
    
    // Verify the data is the same
    const retrievedSecondData = new Uint8Array(retrieveSecondBody.data);
    assertEquals(retrievedSecondData.length, secondData.length);
    for (let i = 0; i < secondData.length; i++) {
      assertEquals(retrievedSecondData[i], secondData[i]);
    }
    
    console.log('Complete flow test with in-memory database passed successfully');
  } catch (error) {
    console.error('Complete flow test with in-memory database failed:', error);
    throw error;
  }
});

Deno.test('Route handler with fake database: Error cases', async () => {
  // Create a fake database instance
  const db = new FakeDatabase();
  const handler = createRouteHandler(db as any, fakeAuthenticator); // Cast to any to avoid type issues
  
  // Generate test key pair
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeUrlBase64(keyPair.publicKey);
  const testPubkey = encodedPubkey;
  
  try {
    // Test retrieving non-existent blob
    const retrieveRequest = createFakeRequest(createEncodedPath(testPubkey, 'nonexistent-blob'));
    const retrieveResponse = await handler(retrieveRequest);
    assertEquals(retrieveResponse.status, 404);
    
    // Test storing blob with missing headers
    const testData = new TextEncoder().encode('Test data');
    
    const storeRequest1 = createFakeRequest(createEncodedPath(testPubkey), {
      method: 'POST',
      body: testData
    });
    
    const storeResponse1 = await handler(storeRequest1);
    // Should fail due to missing headers
    assertEquals(storeResponse1.status, 400);
    
    // Test storing blob with missing hash header
    const storeRequest2 = createFakeRequest(createEncodedPath(testPubkey), {
      method: 'POST',
      headers: {
        'X-Tributary-Authorization': 'some-signature'
      },
      body: testData
    });
    
    const storeResponse2 = await handler(storeRequest2);
    assertEquals(storeResponse2.status, 400);
    
    // Test storing blob with missing signature header
    const storeRequest3 = createFakeRequest(createEncodedPath(testPubkey), {
      method: 'POST',
      headers: {
        'X-Tributary-Hash': 'some-hash'
      },
      body: testData
    });
    
    const storeResponse3 = await handler(storeRequest3);
    assertEquals(storeResponse3.status, 400);
    
    console.log('Error cases test with in-memory database passed successfully');
  } catch (error) {
    console.error('Error cases test with in-memory database failed:', error);
    throw error;
  }
});

Deno.test('FakeDatabase getAllBlobMetadataPaginated with pagination', async () => {
  const db = new FakeDatabase();
  
  // Generate test key pair
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeUrlBase64(keyPair.publicKey);
  
  // Create 5 blobs
  const testData1 = new TextEncoder().encode('Blob 1');
  const hash1 = await computeChainHash('', testData1);
  const sig1 = generateTestSignature(new TextEncoder().encode(hash1), keyPair);
  
  const testData2 = new TextEncoder().encode('Blob 2');
  const hash2 = await computeChainHash(hash1, testData2);
  const sig2 = generateTestSignature(new TextEncoder().encode(hash2), keyPair);
  
  const testData3 = new TextEncoder().encode('Blob 3');
  const hash3 = await computeChainHash(hash2, testData3);
  const sig3 = generateTestSignature(new TextEncoder().encode(hash3), keyPair);
  
  const testData4 = new TextEncoder().encode('Blob 4');
  const hash4 = await computeChainHash(hash3, testData4);
  const sig4 = generateTestSignature(new TextEncoder().encode(hash4), keyPair);
  
  const testData5 = new TextEncoder().encode('Blob 5');
  const hash5 = await computeChainHash(hash4, testData5);
  const sig5 = generateTestSignature(new TextEncoder().encode(hash5), keyPair);
  
  // Store 5 blobs
  await db.storeBlob({
    id: `${encodedPubkey}:1`,
    pubkey: encodedPubkey,
    data: testData1,
    hash: hash1,
    prior_hash: '',
    signature: sig1,
    sequence_number: 1,
    created_at: new Date()
  });
  
  await db.storeBlob({
    id: `${encodedPubkey}:2`,
    pubkey: encodedPubkey,
    data: testData2,
    hash: hash2,
    prior_hash: hash1,
    signature: sig2,
    sequence_number: 2,
    created_at: new Date()
  });
  
  await db.storeBlob({
    id: `${encodedPubkey}:3`,
    pubkey: encodedPubkey,
    data: testData3,
    hash: hash3,
    prior_hash: hash2,
    signature: sig3,
    sequence_number: 3,
    created_at: new Date()
  });
  
  await db.storeBlob({
    id: `${encodedPubkey}:4`,
    pubkey: encodedPubkey,
    data: testData4,
    hash: hash4,
    prior_hash: hash3,
    signature: sig4,
    sequence_number: 4,
    created_at: new Date()
  });
  
  await db.storeBlob({
    id: `${encodedPubkey}:5`,
    pubkey: encodedPubkey,
    data: testData5,
    hash: hash5,
    prior_hash: hash4,
    signature: sig5,
    sequence_number: 5,
    created_at: new Date()
  });
  
  // Test 1: Get all blobs (no filter, no max)
  let result = await db.getAllBlobMetadataPaginated(encodedPubkey);
  assertEquals(result.blobs.length, 5);
  assertEquals(result.total_count, 5);
  
  // Test 2: Get blobs with start_sequence=0, max=2 (should get 2 blobs, total=5)
  result = await db.getAllBlobMetadataPaginated(encodedPubkey, 0, 2);
  assertEquals(result.blobs.length, 2);
  assertEquals(result.total_count, 5); // Total should still be 5, not filtered
  assertEquals(result.blobs[0].sequence_number, 1);
  assertEquals(result.blobs[1].sequence_number, 2);
  
  // Test 3: Get blobs with start_sequence=2, max=10 (should get 3 blobs: 3,4,5, total=5)
  result = await db.getAllBlobMetadataPaginated(encodedPubkey, 2, 10);
  assertEquals(result.blobs.length, 3);
  assertEquals(result.total_count, 5);
  assertEquals(result.blobs[0].sequence_number, 3);
  assertEquals(result.blobs[1].sequence_number, 4);
  assertEquals(result.blobs[2].sequence_number, 5);
  
  // Test 4: Get blobs with start_sequence=5 (should get 0 blobs, total=5)
  result = await db.getAllBlobMetadataPaginated(encodedPubkey, 5, 10);
  assertEquals(result.blobs.length, 0);
  assertEquals(result.total_count, 5);
  
  console.log('FakeDatabase getAllBlobMetadataPaginated test passed successfully');
});
