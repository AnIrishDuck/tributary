// Route tests for tributary-fn
import { assert, assertEquals } from 'jsr:@std/assert@1';
import util from 'tweetnacl-util';
import nacl from 'tweetnacl';
import { Database } from '../../shared/database.ts';
import { verifySignature, computeChainHash, encodeUrlBase64, decodeUrlBase64 } from '../../shared/crypto.ts';
import { createRouteHandler } from '../../shared/routes.ts';

// GOOSE: we need to be using encodeUrlBase64 throughout this test
const { encodeBase64 } = util;

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
  const handler = createRouteHandler(db);
  
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
  const handler = createRouteHandler(db);
  
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
  const handler = createRouteHandler(db);
  
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
  const handler = createRouteHandler(db);
  
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
  const handler = createRouteHandler(db);
  
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
  const handler = createRouteHandler(db);
  
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
