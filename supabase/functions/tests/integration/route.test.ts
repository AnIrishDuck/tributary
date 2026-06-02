// Route tests for tributary-fn
import { assert, assertEquals } from 'jsr:@std/assert@1';
import util from 'tweetnacl-util';
import nacl from 'tweetnacl';
import { Database } from '../../shared/database.ts';
import { verifySignature, computeChainHash, encodeUrlBase64, decodeUrlBase64 } from '../../shared/crypto.ts';
import { createRouteHandler, Authenticator } from '../../shared/routes.ts';

// GOOSE: we need to be using encodeUrlBase64 throughout this test
const { encodeBase64 } = util;

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

Deno.test('Route testing: Health endpoint', async () => {
  // Test that the health endpoint works correctly
  // This validates basic routing functionality
  
  // Create a database instance with noSessions flag for testing
  const db = new Database(true);
  const handler = createRouteHandler(db, fakeAuthenticator);
  
  // Create a fake request for the health endpoint
  const request = createFakeRequest('/health');
  const response = await handler(request);
  
  assertEquals(response.status, 200);
  
  const body = await response.json();
  assertEquals(body.status, 'healthy');
  assertEquals(body.service, 'tributary-fn');
});

Deno.test('Route testing: Store and retrieve blob', async () => {
  // Create a database instance with noSessions flag for testing
  const db = new Database(true);
  const handler = createRouteHandler(db, fakeAuthenticator);
  
  // Generate test key pair
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeUrlBase64(keyPair.publicKey);
  // Don't add suffix for actual testing since it messes up the signature verification
  const testPubkey = encodedPubkey;
  
  try {
    // Test data for blob
    const testData = new TextEncoder().encode('Test data for route testing');
    const chainHash = await computeChainHash('', testData);
    
    // Generate signature for the chain hash
    const hashBytes = new TextEncoder().encode(chainHash);
    const signature = generateTestSignature(hashBytes, keyPair);
    
    // Test storing a blob via the route handler
    const storeRequest = createFakeRequest(createEncodedPath(testPubkey), {
      method: 'POST',
      headers: {
        'X-Tributary-Hash': chainHash,
        'X-Tributary-Authorization': signature
      },
      body: testData
    });
    
    const storeResponse = await handler(storeRequest);
    
    // Should succeed with real database connection
    assertEquals(storeResponse.status, 200);
    
    console.log('Route testing: Store blob test completed successfully');
  } catch (error) {
    console.error('Route testing failed:', error);
    throw error;
  }
});

Deno.test('Route testing: Collection info endpoint', async () => {
  // Create a database instance with noSessions flag for testing
  const db = new Database(true);
  const handler = createRouteHandler(db, fakeAuthenticator);
  
  // Generate test key pair
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeUrlBase64(keyPair.publicKey);
  // Don't add suffix for actual testing to avoid signature issues
  const testPubkey = encodedPubkey;
  
  try {
    // Test the info endpoint
    const infoRequest = createFakeRequest(createEncodedPath(testPubkey, 'info'));
    const infoResponse = await handler(infoRequest);
    
    // Should return 200 with real database connection
    assertEquals(infoResponse.status, 200);
    
    const infoBody = await infoResponse.json();
    assertEquals(infoBody.pubkey, testPubkey);
    
    console.log('Route testing: Collection info endpoint test completed successfully');
  } catch (error) {
    console.error('Route testing for info endpoint failed:', error);
    throw error;
  }
});

Deno.test('Route testing: Latest blob endpoint', async () => {
  // Create a database instance with noSessions flag for testing
  const db = new Database(true);
  const handler = createRouteHandler(db, fakeAuthenticator);
  
  // Generate test key pair
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeUrlBase64(keyPair.publicKey);
  // Don't add suffix for actual testing to avoid signature issues
  const testPubkey = encodedPubkey;
  
  try {
    // Test the latest endpoint
    const latestRequest = createFakeRequest(createEncodedPath(testPubkey, 'latest'));
    const latestResponse = await handler(latestRequest);
    
    // Should return 404 for no data found
    assertEquals(latestResponse.status, 404);
    
    console.log('Route testing: Latest blob endpoint test completed successfully');
  } catch (error) {
    console.error('Route testing for latest endpoint failed:', error);
    throw error;
  }
});

Deno.test('Route testing: Error cases', async () => {
  // Create a database instance with noSessions flag for testing
  const db = new Database(true);
  const handler = createRouteHandler(db, fakeAuthenticator);
  
  try {
    // Test retrieving non-existent blob
    const retrieveRequest = createFakeRequest(createEncodedPath('nonexistent-pubkey', 'nonexistent-blob'));
    const retrieveResponse = await handler(retrieveRequest);
    assertEquals(retrieveResponse.status, 404);
    
    // Test storing blob with missing headers
    const testData = new TextEncoder().encode('Test data');
    
    const storeRequest1 = createFakeRequest(createEncodedPath('test-pubkey'), {
      method: 'POST',
      body: testData
    });
    
    const storeResponse1 = await handler(storeRequest1);
    // Should fail due to missing headers
    assertEquals(storeResponse1.status, 400);
    
    console.log('Route testing: Error cases test completed successfully');
  } catch (error) {
    console.error('Route testing for error cases failed:', error);
    throw error;
  }
});

Deno.test('Route testing: Date handling in latest endpoint', async () => {
  const db = new Database(true);
  const handler = createRouteHandler(db, fakeAuthenticator);
  
  // Generate test key pair
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeUrlBase64(keyPair.publicKey);
  const testPubkey = encodedPubkey; // Use just the base64 pubkey
  
  try {
    // Add a blob to the database
    const testData = new TextEncoder().encode('Test data for date handling regression test');
    const chainHash = await computeChainHash('', testData);
    
    // Generate signature for the chain hash
    const hashBytes = new TextEncoder().encode(chainHash);
    const signature = generateTestSignature(hashBytes, keyPair);
    
    // Store a blob via the route handler
    const storeRequest = createFakeRequest(createEncodedPath(testPubkey), {
      method: 'POST',
      headers: {
        'X-Tributary-Hash': chainHash,
        'X-Tributary-Authorization': signature
      },
      body: testData
    });
    
    const storeResponse = await handler(storeRequest);
    assertEquals(storeResponse.status, 200);
    
    // Test the latest endpoint - this should work correctly with proper Date handling
    const latestRequest = createFakeRequest(createEncodedPath(testPubkey, 'latest'));
    const latestResponse = await handler(latestRequest);
    
    // This should succeed (status 200) instead of failing with 500
    assertEquals(latestResponse.status, 200);
    
    // Parse the response to make sure it's valid JSON
    const latestResponseBody = await latestResponse.json();
    console.log('Latest endpoint response:', latestResponseBody);
    
    // Verify that created_at is properly formatted as an ISO string
    assert(typeof latestResponseBody.created_at === 'string');
    // Try to create a Date from it to ensure it's a valid ISO string
    const date = new Date(latestResponseBody.created_at);
    assert(!isNaN(date.getTime()), 'created_at should be a valid ISO date string');
    
    console.log('SUCCESS: Date handling regression test passed - latest endpoint works correctly!');
    assertEquals(true, true);
  } catch (error) {
    console.error('Regression test failed with unexpected error:', error);
    throw error;
  }
});

Deno.test('Route testing: Get blobs Arrow endpoint', async () => {
  const db = new Database(true);
  const handler = createRouteHandler(db, fakeAuthenticator);
  
  // Generate test key pair
  const keyPair = nacl.sign.keyPair();
  const encodedPubkey = encodeUrlBase64(keyPair.publicKey);
  const testPubkey = encodedPubkey;
  
  try {
    // Store 3 blobs to test pagination
    let priorHash = '';
    for (let i = 1; i <= 3; i++) {
      const testData = new TextEncoder().encode(`Test data ${i}`);
      const chainHash = await computeChainHash(priorHash, testData);
      
      const hashBytes = new TextEncoder().encode(chainHash);
      const signature = generateTestSignature(hashBytes, keyPair);
      
      const storeRequest = createFakeRequest(createEncodedPath(testPubkey), {
        method: 'POST',
        headers: {
          'X-Tributary-Hash': chainHash,
          'X-Tributary-Authorization': signature
        },
        body: testData
      });
      
      const storeResponse = await handler(storeRequest);
      assertEquals(storeResponse.status, 200);
      
      priorHash = chainHash;
    }
    
    // Test the blobs endpoint
    const blobsRequest = createFakeRequest(createEncodedPath(testPubkey, 'blobs') + '?max=10');
    const blobsResponse = await handler(blobsRequest);
    
    // Should return 200 with Arrow data
    assertEquals(blobsResponse.status, 200);
    
    // Check content type
    const contentType = blobsResponse.headers.get('Content-Type');
    assertEquals(contentType, 'application/vnd.apache.arrow.stream');
    
    // Check total count header
    const totalCount = blobsResponse.headers.get('X-Total-Count');
    assertEquals(totalCount, '3');
    
    // Get the Arrow IPC data
    const arrowData = await blobsResponse.arrayBuffer();
    assert(arrowData.byteLength > 0, 'Arrow data should not be empty');
    
    console.log(`Route testing: Get blobs Arrow endpoint returned ${arrowData.byteLength} bytes`);
    
    // Test with pagination (start_sequence)
    const blobsRequest2 = createFakeRequest(createEncodedPath(testPubkey, 'blobs') + '?start_sequence=1&max=10');
    const blobsResponse2 = await handler(blobsRequest2);
    assertEquals(blobsResponse2.status, 200);
    
    // Test with invalid parameters
    const blobsRequest3 = createFakeRequest(createEncodedPath(testPubkey, 'blobs') + '?start_sequence=-1');
    const blobsResponse3 = await handler(blobsRequest3);
    assertEquals(blobsResponse3.status, 400);
    
    console.log('Route testing: Get blobs Arrow endpoint test completed successfully');
  } catch (error) {
    console.error('Route testing for blobs Arrow endpoint failed:', error);
    throw error;
  }
});

function assertCorsHeaders(response: Response, label: string) {
  assertEquals(response.headers.get('Access-Control-Allow-Origin'), '*', `${label}: missing Allow-Origin`);
  assert(response.headers.get('Access-Control-Allow-Methods')!.includes('POST'), `${label}: missing Allow-Methods`);
}

Deno.test('Route testing: CORS headers on all response types', async () => {
  const db = new Database(true);
  const handler = createRouteHandler(db, fakeAuthenticator);

  const keyPair = nacl.sign.keyPair();
  const testPubkey = encodeUrlBase64(keyPair.publicKey);

  // Health endpoint (200)
  const healthResp = await handler(createFakeRequest('/health'));
  assertCorsHeaders(healthResp, 'health 200');

  // Info endpoint (200)
  const infoResp = await handler(createFakeRequest(createEncodedPath(testPubkey, 'info')));
  assertCorsHeaders(infoResp, 'info 200');

  // Latest endpoint (404 — no blobs)
  const latestResp = await handler(createFakeRequest(createEncodedPath(testPubkey, 'latest')));
  assertEquals(latestResp.status, 404);
  assertCorsHeaders(latestResp, 'latest 404');

  // Retrieve non-existent blob (404)
  const retrieveResp = await handler(createFakeRequest(createEncodedPath(testPubkey, 'no-such-blob')));
  assertEquals(retrieveResp.status, 404);
  assertCorsHeaders(retrieveResp, 'retrieve 404');

  // Upload with missing headers (400)
  const badUploadResp = await handler(createFakeRequest(createEncodedPath(testPubkey), {
    method: 'POST',
    body: new TextEncoder().encode('data')
  }));
  assertEquals(badUploadResp.status, 400);
  assertCorsHeaders(badUploadResp, 'upload 400');

  // Unknown path (404)
  const notFoundResp = await handler(new Request('http://localhost:54321/functions/v1/stream', { method: 'GET' }));
  assertEquals(notFoundResp.status, 404);
  assertCorsHeaders(notFoundResp, 'not-found 404');

  // Blobs with invalid params (400)
  const badBlobsResp = await handler(createFakeRequest(createEncodedPath(testPubkey, 'blobs') + '?start_sequence=-1'));
  assertEquals(badBlobsResp.status, 400);
  assertCorsHeaders(badBlobsResp, 'blobs 400');
});
