// Integration tests for blob object API endpoints
// Tests the route handlers, database operations, and merkle proof verification.
// TUS/Storage calls are proxied externally, so these tests focus on:
// - Database CRUD for blob_uploads and blob_objects tables
// - Merkle proof verification in crypto.ts
// - Route handler request/response logic with a fake authenticator

import { assert, assertEquals } from 'jsr:@std/assert@1';
import { Database } from '../../shared/database.ts';
import { computeHash, verifyMerkleProof } from '../../shared/crypto.ts';
import { createBlobRouteHandler } from '../../shared/blobRoutes.ts';
import { type Authenticator } from '../../shared/routes.ts';

// --- Helpers ---

const TEST_USER_ID = 'test-user-' + Date.now();

// Fake authenticator that always succeeds with a fixed user ID
const fakeAuth: Authenticator = async (_req) => ({ userId: TEST_USER_ID });

// Fake authenticator that always fails
const failAuth: Authenticator = async (_req) => null;

/** SHA256 hash a string and return hex. */
async function hashHex(data: Uint8Array): Promise<string> {
  return computeHash(data);
}

/**
 * Manually compute the merkle root and proofs for a set of chunk hashes,
 * matching merkletreejs's default SHA256 behaviour.
 * This is a minimal reimplementation for testing — we only need it for
 * small trees (1-4 leaves) used in these tests.
 */
async function buildTestTree(chunkHashes: string[]): Promise<{
  root: string;
  proofs: Array<Array<{ position: 'left' | 'right'; data: string }>>;
}> {
  if (chunkHashes.length === 0) throw new Error('No chunk hashes');

  // Pad to power of 2 by duplicating last leaf (merkletreejs default)
  // Actually merkletreejs doesn't pad — odd leaves get promoted.
  // For simplicity, we'll handle 1 and 2 leaves which cover our test cases.

  const hexToBytes = (hex: string): Uint8Array => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
  };

  const hashPair = async (a: string, b: string): Promise<string> => {
    const aBuf = hexToBytes(a);
    const bBuf = hexToBytes(b);
    const combined = new Uint8Array(aBuf.length + bBuf.length);
    combined.set(aBuf);
    combined.set(bBuf, aBuf.length);
    return computeHash(combined);
  };

  if (chunkHashes.length === 1) {
    // Single leaf — root is the leaf hash itself
    return { root: chunkHashes[0], proofs: [[]] };
  }

  if (chunkHashes.length === 2) {
    const root = await hashPair(chunkHashes[0], chunkHashes[1]);
    return {
      root,
      proofs: [
        [{ position: 'right' as const, data: chunkHashes[1] }],
        [{ position: 'left' as const, data: chunkHashes[0] }],
      ],
    };
  }

  // For 3+ leaves, build level by level
  // Level 0 = leaves
  let currentLevel = [...chunkHashes];
  const layers: string[][] = [currentLevel];

  while (currentLevel.length > 1) {
    const nextLevel: string[] = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      if (i + 1 < currentLevel.length) {
        nextLevel.push(await hashPair(currentLevel[i], currentLevel[i + 1]));
      } else {
        // Odd node gets promoted
        nextLevel.push(currentLevel[i]);
      }
    }
    currentLevel = nextLevel;
    layers.push(currentLevel);
  }

  const root = layers[layers.length - 1][0];

  // Build proofs for each leaf
  const proofs: Array<Array<{ position: 'left' | 'right'; data: string }>> = [];
  for (let leafIndex = 0; leafIndex < chunkHashes.length; leafIndex++) {
    const proof: Array<{ position: 'left' | 'right'; data: string }> = [];
    let idx = leafIndex;
    for (let level = 0; level < layers.length - 1; level++) {
      const layer = layers[level];
      if (idx % 2 === 0) {
        // We're on the left, sibling is on the right
        if (idx + 1 < layer.length) {
          proof.push({ position: 'right', data: layer[idx + 1] });
        }
      } else {
        // We're on the right, sibling is on the left
        proof.push({ position: 'left', data: layer[idx - 1] });
      }
      idx = Math.floor(idx / 2);
    }
    proofs.push(proof);
  }

  return { root, proofs };
}

// --- Merkle Proof Verification Tests ---

Deno.test('verifyMerkleProof: single chunk (empty proof)', async () => {
  const data = new TextEncoder().encode('hello single chunk');
  const hash = await hashHex(data);

  // Single leaf: root === leaf, proof is empty
  const valid = await verifyMerkleProof(hash, hash, []);
  assertEquals(valid, true);
});

Deno.test('verifyMerkleProof: two chunks with valid proof', async () => {
  const chunk0 = new TextEncoder().encode('chunk zero');
  const chunk1 = new TextEncoder().encode('chunk one');
  const hash0 = await hashHex(chunk0);
  const hash1 = await hashHex(chunk1);

  const { root, proofs } = await buildTestTree([hash0, hash1]);

  const valid0 = await verifyMerkleProof(root, hash0, proofs[0]);
  assertEquals(valid0, true);

  const valid1 = await verifyMerkleProof(root, hash1, proofs[1]);
  assertEquals(valid1, true);
});

Deno.test('verifyMerkleProof: tampered chunk hash fails', async () => {
  const chunk0 = new TextEncoder().encode('chunk zero');
  const chunk1 = new TextEncoder().encode('chunk one');
  const hash0 = await hashHex(chunk0);
  const hash1 = await hashHex(chunk1);

  const { root, proofs } = await buildTestTree([hash0, hash1]);

  // Use a fake hash that doesn't match
  const fakeHash = await hashHex(new TextEncoder().encode('tampered'));
  const valid = await verifyMerkleProof(root, fakeHash, proofs[0]);
  assertEquals(valid, false);
});

Deno.test('verifyMerkleProof: three chunks', async () => {
  const hashes: string[] = [];
  for (let i = 0; i < 3; i++) {
    hashes.push(await hashHex(new TextEncoder().encode(`chunk-${i}`)));
  }
  const { root, proofs } = await buildTestTree(hashes);

  for (let i = 0; i < 3; i++) {
    const valid = await verifyMerkleProof(root, hashes[i], proofs[i]);
    assertEquals(valid, true, `Proof for chunk ${i} should be valid`);
  }
});

// --- Database Operations Tests ---

Deno.test('Blob upload lifecycle: create, read, increment, complete', async () => {
  const db = new Database(true);
  const rootHash = 'test_root_' + Date.now();

  // Create upload
  const created = await db.createBlobUpload({
    root_hash: rootHash,
    owner_id: TEST_USER_ID,
    domain: 'test-domain',
    size: 12_000_000,
    chunk_count: 2,
    tus_upload_url: 'https://example.com/tus/upload123',
  });
  assertEquals(created, true);

  // Read upload
  const upload = await db.getBlobUpload(rootHash);
  assert(upload !== null);
  assertEquals(upload!.root_hash, rootHash);
  assertEquals(upload!.owner_id, TEST_USER_ID);
  assertEquals(upload!.domain, 'test-domain');
  assertEquals(upload!.size, 12_000_000);
  assertEquals(upload!.chunk_count, 2);
  assertEquals(upload!.chunks_uploaded, 0);

  // Increment chunks
  const count1 = await db.incrementBlobUploadChunks(rootHash);
  assertEquals(count1, 1);

  const count2 = await db.incrementBlobUploadChunks(rootHash);
  assertEquals(count2, 2);

  // Complete upload — should move to blob_objects and delete upload
  const completed = await db.completeBlobUpload(rootHash);
  assertEquals(completed, true);

  // Upload record should be gone
  const deletedUpload = await db.getBlobUpload(rootHash);
  assertEquals(deletedUpload, null);

  // Blob object should exist
  const blobObj = await db.getBlobObject(rootHash);
  assert(blobObj !== null);
  assertEquals(blobObj!.root_hash, rootHash);
  assertEquals(blobObj!.domain, 'test-domain');
  assertEquals(blobObj!.size, 12_000_000);
  assertEquals(blobObj!.chunk_count, 2);
});

Deno.test('getBlobObject returns null for non-existent blob', async () => {
  const db = new Database(true);
  const result = await db.getBlobObject('nonexistent_root_hash');
  assertEquals(result, null);
});

Deno.test('getBlobUpload returns null for non-existent upload', async () => {
  const db = new Database(true);
  const result = await db.getBlobUpload('nonexistent_root_hash');
  assertEquals(result, null);
});

// --- Route Handler Tests ---

Deno.test('Blob route: health endpoint', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, fakeAuth);

  const req = new Request('http://localhost/blob/health', { method: 'GET' });
  const res = await handler(req);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, 'healthy');
  assertEquals(body.service, 'tributary-blob');
});

Deno.test('Blob route: GET metadata returns 401 without auth', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, failAuth);

  const req = new Request('http://localhost/blob/somehash', { method: 'GET' });
  const res = await handler(req);
  assertEquals(res.status, 401);
});

Deno.test('Blob route: GET metadata returns 404 for non-existent blob', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, fakeAuth);

  const req = new Request('http://localhost/blob/nonexistent_' + Date.now(), { method: 'GET' });
  const res = await handler(req);
  assertEquals(res.status, 404);
});

Deno.test('Blob route: GET metadata returns blob info after upload completes', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, fakeAuth);
  const rootHash = 'metadata_test_' + Date.now();

  // Manually insert a completed blob object for this test
  await db.createBlobUpload({
    root_hash: rootHash,
    owner_id: TEST_USER_ID,
    domain: 'metadata-test',
    size: 6_000_000,
    chunk_count: 1,
    tus_upload_url: null,
  });
  await db.incrementBlobUploadChunks(rootHash);
  await db.completeBlobUpload(rootHash);

  const req = new Request(`http://localhost/blob/${rootHash}`, { method: 'GET' });
  const res = await handler(req);
  assertEquals(res.status, 200);

  const body = await res.json();
  assertEquals(body.rootHash, rootHash);
  assertEquals(body.domain, 'metadata-test');
  assertEquals(body.size, 6_000_000);
  assertEquals(body.chunkCount, 1);
  assert(typeof body.createdAt === 'string');
});

Deno.test('Blob route: POST upload requires auth', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, failAuth);

  const req = new Request('http://localhost/blob/somehash/upload', {
    method: 'POST',
    body: JSON.stringify({ chunkCount: 1, totalSize: 100, domain: 'test' }),
    headers: { 'Content-Type': 'application/json' },
  });
  const res = await handler(req);
  assertEquals(res.status, 401);
});

Deno.test('Blob route: PATCH chunk requires auth', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, failAuth);

  const req = new Request('http://localhost/blob/somehash/chunk/0', {
    method: 'PATCH',
    body: new Uint8Array([1, 2, 3]),
    headers: { 'X-Merkle-Proof': '[]' },
  });
  const res = await handler(req);
  assertEquals(res.status, 401);
});

Deno.test('Blob route: PATCH chunk returns 404 for unknown upload', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, fakeAuth);

  const req = new Request('http://localhost/blob/unknown_root/chunk/0', {
    method: 'PATCH',
    body: new Uint8Array([1, 2, 3]),
    headers: { 'X-Merkle-Proof': '[]' },
  });
  const res = await handler(req);
  assertEquals(res.status, 404);
});

Deno.test('Blob route: PATCH chunk rejects missing merkle proof header', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, fakeAuth);
  const rootHash = 'noproof_test_' + Date.now();

  // Create upload record
  await db.createBlobUpload({
    root_hash: rootHash,
    owner_id: TEST_USER_ID,
    domain: 'test',
    size: 100,
    chunk_count: 1,
    tus_upload_url: null,
  });

  const req = new Request(`http://localhost/blob/${rootHash}/chunk/0`, {
    method: 'PATCH',
    body: new Uint8Array([1, 2, 3]),
    // No X-Merkle-Proof header
  });
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assert(body.error.includes('X-Merkle-Proof'));

  // Cleanup
  await db.deleteBlobUpload(rootHash);
});

Deno.test('Blob route: PATCH chunk rejects invalid merkle proof', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, fakeAuth);

  const chunkData = new TextEncoder().encode('test chunk data');
  const chunkHash = await hashHex(chunkData);

  // Use a root hash that won't match the proof
  const fakeRoot = 'badrootbadrootbadrootbadrootbadrootbadrootbadrootbadrootbadrootba';

  await db.createBlobUpload({
    root_hash: fakeRoot,
    owner_id: TEST_USER_ID,
    domain: 'test',
    size: chunkData.length,
    chunk_count: 1,
    tus_upload_url: null,
  });

  const req = new Request(`http://localhost/blob/${fakeRoot}/chunk/0`, {
    method: 'PATCH',
    body: chunkData,
    headers: {
      'X-Merkle-Proof': JSON.stringify([]),
    },
  });
  const res = await handler(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assert(body.error.includes('Merkle proof'));

  // Cleanup
  await db.deleteBlobUpload(fakeRoot);
});

Deno.test('Blob route: OPTIONS returns CORS headers', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, fakeAuth);

  const req = new Request('http://localhost/blob/somehash', { method: 'OPTIONS' });
  const res = await handler(req);
  assertEquals(res.status, 204);
  assert(res.headers.get('Access-Control-Allow-Origin') === '*');
});

Deno.test('Blob route: unknown path returns 404', async () => {
  const db = new Database(true);
  const handler = createBlobRouteHandler(db, fakeAuth);

  const req = new Request('http://localhost/blob/somehash/unknown', { method: 'GET' });
  const res = await handler(req);
  assertEquals(res.status, 404);
});
