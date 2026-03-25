# Plan: Tributary Blobs

Content-addressed immutable binary objects with merkle tree verification for multipart uploads, stored in Supabase Storage.

## Design Decisions

- **Chunk size**: 4 MB per chunk
- **Storage**: One Supabase Storage object per chunk (keyed by chunk hash). On read, reassemble from the merkle tree structure.
- **Merkle tree**: Binary tree where leaves are SHA256(chunk_data), interior nodes are SHA256(left || right). Root hash is the content address / object key.

---

## Prompt 1: Merkle Tree Library (`tributary-client`)

**Goal**: Pure TypeScript merkle tree library for building trees from data, generating proofs, and verifying proofs.

### Files to create/modify
- **Create** `tributary-client/src/merkleTree.ts` - Core library
- **Create** `tributary-client/test/merkle-tree.test.ts` - Tests
- **Modify** `tributary-client/src/index.ts` - Export new module

### What to implement
- `CHUNK_SIZE = 4 * 1024 * 1024` (4MB)
- `buildMerkleTree(data: Uint8Array): MerkleTree` - Splits data into chunks, computes leaf hashes, builds binary tree bottom-up. Returns tree structure with root hash, all node hashes, and chunk count.
- `MerkleTree` type: `{ rootHash: string, nodes: string[][], chunkCount: number, chunkSize: number }`
  - `nodes[0]` = leaf hashes, `nodes[1]` = parent hashes, etc. Last level has the root.
- `getMerkleProof(tree: MerkleTree, chunkIndex: number): MerkleProof` - Returns the sibling hashes needed to verify a chunk back to the root.
- `MerkleProof` type: `{ chunkIndex: number, chunkHash: string, siblings: Array<{ hash: string, position: 'left' | 'right' }>, rootHash: string }`
- `verifyMerkleProof(proof: MerkleProof): boolean` - Recomputes path from leaf to root using sibling hashes, checks it matches rootHash.
- `computeChunkHash(chunk: Uint8Array): Promise<string>` - SHA256 of chunk data (reuse `computeHash` from `hashUtils.ts`)
- Handle edge cases: empty data, single-chunk data, odd number of chunks (duplicate last hash), data not aligned to chunk size.

### Test coverage
- Build tree from known data, verify root hash is deterministic
- Single-chunk file (< 4MB) produces a one-level tree
- Multi-chunk file produces correct tree depth
- Proof generation and verification for each chunk in a multi-chunk file
- Tampered proof fails verification (wrong sibling hash, wrong chunk hash)
- Empty data edge case
- Odd number of chunks (padding behavior)

### Estimated size: ~250 LOC code + ~200 LOC tests

---

## Prompt 2: Blob Server API (`supabase/functions/`)

**Goal**: New edge function endpoint for uploading and downloading content-addressed blob chunks, with merkle proof verification. Uses Supabase Storage as the backing store.

### Files to create/modify
- **Create** `supabase/functions/blob/index.ts` - Edge function entry point
- **Create** `supabase/functions/shared/blobRoutes.ts` - Route handlers
- **Create** `supabase/functions/shared/blobDatabase.ts` - DB operations for blob metadata
- **Create** `supabase/functions/shared/blobModels.ts` - Type definitions
- **Create** `supabase/migrations/YYYYMMDD_blob_objects.sql` - Migration for blob tracking table
- **Modify** `supabase/functions/shared/crypto.ts` - Add `verifyMerkleProof` (reuse from client or re-implement for Deno)

### Database schema
```sql
CREATE TABLE blob_objects (
  root_hash TEXT NOT NULL,         -- content address (merkle root)
  chunk_count INTEGER NOT NULL,    -- total chunks expected
  chunk_size INTEGER NOT NULL,     -- bytes per chunk (except possibly last)
  total_size BIGINT NOT NULL,      -- total object size in bytes
  content_type TEXT,               -- MIME type
  owner_id UUID NOT NULL,          -- Supabase auth user
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (root_hash)
);

CREATE TABLE blob_chunks (
  root_hash TEXT NOT NULL REFERENCES blob_objects(root_hash),
  chunk_index INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,        -- SHA256 of this chunk's data
  uploaded BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (root_hash, chunk_index)
);
```

### API endpoints
- `POST /blob/{root_hash}/init` - Initialize upload. Body: `{ chunkCount, chunkSize, totalSize, contentType, chunkHashes: string[] }`. Server stores metadata + chunk manifest. Verifies chunk hashes produce the claimed root_hash via merkle tree reconstruction.
- `POST /blob/{root_hash}/chunk/{index}` - Upload a chunk. Body: raw binary. Header: `X-Chunk-Hash`. Server verifies hash matches manifest, stores in Supabase Storage bucket `tributary-blobs` with key `{chunk_hash}`, marks chunk as uploaded.
- `GET /blob/{root_hash}` - Get blob metadata (chunk count, size, content type, which chunks are uploaded).
- `GET /blob/{root_hash}/chunk/{index}` - Download a specific chunk from Supabase Storage.
- Auth: all endpoints require Supabase JWT (same pattern as stream endpoints).

### Test coverage
- Integration tests using the route handler directly (same pattern as `supabase/functions/tests/integration/api.test.ts`)
- Init + upload all chunks + verify metadata shows complete
- Reject init with mismatched root hash (chunk hashes don't produce claimed root)
- Reject chunk upload with wrong hash
- Reject duplicate init (idempotent)
- Download returns correct chunk data

### Estimated size: ~400 LOC code + ~200 LOC tests

---

## Prompt 3: Blob Client (`tributary-client`)

**Goal**: Client-side API for uploading and downloading blobs, integrating with the merkle tree library and the blob server API.

### Files to create/modify
- **Create** `tributary-client/src/blobClient.ts` - Upload/download API
- **Modify** `tributary-client/src/server.ts` - Add blob methods to `Server` interface
- **Modify** `tributary-client/src/fakeServer.ts` - Add fake blob server implementation (in-memory Supabase Storage fake)
- **Modify** `tributary-client/src/tributaryServer.ts` - Add real blob server implementation (HTTP calls)
- **Create** `tributary-client/test/blob-client.test.ts` - Tests
- **Modify** `tributary-client/src/index.ts` - Export new module

### What to implement
- `BlobClient` class or standalone functions:
  - `uploadBlob(server: Server, data: Uint8Array, contentType: string): Promise<string>` - Chunks data, builds merkle tree, calls init, uploads all chunks. Returns root hash.
  - `downloadBlob(server: Server, rootHash: string): Promise<Uint8Array>` - Fetches metadata, downloads all chunks, reassembles in order. Verifies root hash matches.
  - `getBlobMetadata(server: Server, rootHash: string): Promise<BlobMetadata>` - Returns metadata (size, content type, upload completeness).
- `Server` interface additions:
  - `initBlobUpload(rootHash, chunkCount, chunkSize, totalSize, contentType, chunkHashes): Promise<boolean>`
  - `uploadBlobChunk(rootHash, chunkIndex, data, chunkHash): Promise<boolean>`
  - `getBlobInfo(rootHash): Promise<BlobInfo | null>`
  - `downloadBlobChunk(rootHash, chunkIndex): Promise<Uint8Array | null>`
- `FakeServer` implementation: in-memory Map storing chunks + metadata.

### Test coverage
- Upload small blob (single chunk), download and verify identical
- Upload large blob (multi-chunk), download and verify identical
- Upload returns deterministic root hash for same data
- FakeServer correctly stores and retrieves chunks
- Download verifies merkle root matches

### Estimated size: ~350 LOC code + ~150 LOC tests

---

## Key Files Reference
- `tributary-client/src/hashUtils.ts` - reuse `computeHash`, `computeHashBytes`
- `tributary-client/src/server.ts` - `Server` interface to extend
- `tributary-client/src/fakeServer.ts` - `FakeServer` to extend for testing
- `tributary-client/src/tributaryServer.ts` - real HTTP server implementation
- `supabase/functions/shared/crypto.ts` - server-side crypto (reuse for merkle verification)
- `supabase/functions/shared/routes.ts` - pattern for route handlers
- `supabase/functions/shared/database.ts` - pattern for DB operations
