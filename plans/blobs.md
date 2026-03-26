# Plan: Tributary Blobs

Content-addressed immutable binary objects with merkle-tree-verified multipart uploads, stored encrypted in Supabase Storage.

## Design Decisions

- **Chunk size**: 6 MB per chunk (before encryption). Aligned with Supabase Storage's TUS chunk size requirement.
- **Upload protocol**: [TUS](https://tus.io/) (resumable upload protocol), which Supabase Storage natively supports. Our edge function is a **thin auth + verification proxy** around Supabase's TUS endpoint. It authenticates the user, verifies merkle proofs, enforces quotas, and forwards chunks to Storage using the service_role key. It does not buffer or assemble data itself — Supabase handles that.
- **Storage**: One Supabase Storage object per blob at `tributary-blobs/{root_hash}`. Supabase TUS auto-assembles chunks into the final object when the upload completes.
- **Merkle tree**: Each chunk upload includes a merkle proof (sibling hashes back to the root) so the edge function can verify every chunk belongs to the claimed blob before forwarding it to Storage. We use [`merkletreejs`](https://github.com/merkletreejs/merkletreejs) (SHA256, ~97k weekly downloads) rather than rolling our own.
- **Database**: Simple `blobs` metadata table tracking creator, domain, size, and root hash. Inserted after upload completes. No chunk-level tracking.
- **Encryption**: Each chunk is encrypted with `nacl.secretbox` (XSalsa20-Poly1305) using an encryption key derived from the stream's read key. Nonce is prepended to each encrypted chunk. Server only sees ciphertext.
- **Content addressing**: The root hash of the merkle tree (computed over encrypted chunk hashes) is the blob's content address and Storage key.

---

## Prompt 1: Chunking + Merkle Helpers (`tributary-client`)

**Goal**: Thin wrapper around `merkletreejs` for chunking data, encrypting chunks, computing the merkle root, and generating/verifying proofs. No custom tree implementation.

### Files to create/modify
- **Create** `tributary-client/src/blobHelpers.ts` - Chunking, encryption, merkle helpers
- **Create** `tributary-client/test/blob-helpers.test.ts` - Tests
- **Modify** `tributary-client/package.json` - Add `merkletreejs` dependency

### What to implement
- `BLOB_CHUNK_SIZE = 6 * 1024 * 1024` (6MB)
- `chunkData(data: Uint8Array): Uint8Array[]` — Split data into ≤ BLOB_CHUNK_SIZE pieces
- `encryptChunk(chunk: Uint8Array, encryptionKey: Uint8Array): Uint8Array` — `nonce || nacl.secretbox(chunk, nonce, key)` with random 24-byte nonce
- `decryptChunk(encrypted: Uint8Array, encryptionKey: Uint8Array): Uint8Array` — Split nonce, decrypt
- `computeChunkHash(chunk: Uint8Array): Promise<string>` — SHA256 hex via `computeHash` from `hashUtils.ts`
- `buildChunkTree(chunkHashes: string[]): { root: string, tree: MerkleTree }` — Construct tree using `merkletreejs` with SHA256, return root hash and tree object
- `getChunkProof(tree: MerkleTree, chunkHash: string): string[]` — Get merkle proof (sibling hashes) for a specific chunk
- `verifyChunkProof(root: string, chunkHash: string, proof: string[]): boolean` — Verify a chunk belongs to the tree given the root and proof

### Test coverage
- Chunk + encrypt + decrypt round-trips correctly
- Deterministic root hash for same encrypted chunks
- Single-chunk blob produces valid tree
- Multi-chunk proof generation and verification
- Tampered chunk hash fails verification
- Edge cases: empty data, data exactly at chunk boundary

### Estimated size: ~120 LOC code + ~150 LOC tests

---

## Prompt 2: Blob Server API (`supabase/functions/`)

**Goal**: Thin edge function proxy around Supabase Storage's TUS endpoint. Handles auth, merkle proof verification, quota enforcement, and blob metadata. Does **not** buffer or assemble blob data — Supabase TUS handles that natively.

### Files to create/modify
- **Create** `supabase/functions/blob/index.ts` - Edge function entry point
- **Create** `supabase/functions/shared/blobRoutes.ts` - Route handlers
- **Create** `supabase/functions/shared/blobModels.ts` - Type definitions
- **Create** `supabase/migrations/YYYYMMDD_blobs.sql` - Migration for blobs metadata table
- **Modify** `supabase/functions/shared/crypto.ts` - Add `verifyMerkleProof` (verify chunk hash + proof against root)

### Database schema
```sql
CREATE TABLE blobs (
  root_hash TEXT PRIMARY KEY,           -- content address (merkle root of encrypted chunks)
  owner_id UUID NOT NULL,               -- Supabase auth user who uploaded
  domain TEXT NOT NULL,                  -- app domain / context (e.g. stream ID)
  size BIGINT NOT NULL,                 -- total blob size in bytes (encrypted)
  created_at TIMESTAMP DEFAULT NOW()
);
```

### Upload protocol (TUS proxy)

The edge function proxies TUS protocol calls to `{SUPABASE_URL}/storage/v1/upload/resumable`, authenticating with the service_role key. The client never talks to Supabase Storage directly.

**`POST /blob/{root_hash}/upload`** — Create TUS upload session.
- Client sends: `{ chunkCount, totalSize, domain }`
- Edge function:
  1. Authenticates user (JWT, same as stream endpoints)
  2. Checks quota (optional, future)
  3. Creates TUS upload via `POST /storage/v1/upload/resumable` with headers:
     - `Authorization: Bearer {service_role_key}`
     - `Upload-Length: {totalSize}`
     - `Upload-Metadata: bucketName {base64("tributary-blobs")}, objectName {base64(root_hash)}`
     - `Tus-Resumable: 1.0.0`
  4. Stores `{ root_hash, tus_upload_id, owner_id, domain, size, chunk_count }` in a `blob_uploads` temporary table (or the `blobs` table with a `status` column)
  5. Returns `{ tusUploadId }` to client

**`PATCH /blob/{root_hash}/chunk/{index}`** — Upload a chunk (TUS PATCH proxy).
- Client sends: raw binary body + `X-Merkle-Proof` header (JSON array of proof hashes)
- Edge function:
  1. Authenticates user
  2. Hashes the chunk data (SHA256)
  3. Verifies the merkle proof: chunk hash + proof → root hash matches `{root_hash}`
  4. Forwards to TUS endpoint via `PATCH /storage/v1/upload/resumable` with headers:
     - `Authorization: Bearer {service_role_key}`
     - `Upload-Offset: {index * BLOB_CHUNK_SIZE}` (computed from chunk index)
     - `Content-Type: application/offset+octet-stream`
     - `Tus-Resumable: 1.0.0`
  5. Returns success

**On final chunk**: When TUS auto-completes (Upload-Offset reaches Upload-Length), the Storage object is assembled. The edge function inserts the `blobs` DB row at this point (detects completion from the TUS response offset matching total size).

### Read endpoints

**`GET /blob/{root_hash}`** — Blob metadata from the `blobs` table.

**`GET /blob/{root_hash}/data`** — Proxy download from Supabase Storage.
- Edge function fetches `tributary-blobs/{root_hash}` from Storage using service_role key
- Streams the response back to the client
- Supports HTTP Range headers (pass through to Storage)

### Auth
- All endpoints require Supabase JWT (same `authenticateUser` pattern as stream endpoints)
- Edge function uses `SUPABASE_SERVICE_ROLE_KEY` for all Storage and DB operations

### Test coverage
- Integration tests using the route handler directly (same pattern as existing `api.test.ts`)
- Init + upload all chunks → blob exists in storage and DB
- Reject chunk with invalid merkle proof
- Reject chunk with hash that doesn't match proof
- Download returns correct full encrypted blob
- Metadata returns correct blob info
- Auth required on all endpoints

### Estimated size: ~350 LOC code + ~200 LOC tests

---

## Prompt 3: `TributaryBlob` Class (`tributary-client`)

**Goal**: High-level client class for uploading and downloading encrypted blobs, tied to a stream's read key for encryption.

### Files to create/modify
- **Create** `tributary-client/src/tributaryBlob.ts` - `TributaryBlob` class
- **Create** `tributary-client/test/tributary-blob.test.ts` - Tests
- **Modify** `tributary-client/src/server.ts` - Add blob methods to `Server` interface
- **Modify** `tributary-client/src/fakeServer.ts` - Add fake blob server (in-memory storage)
- **Modify** `tributary-client/src/tributaryServer.ts` - Add real blob server (HTTP calls)
- **Modify** `tributary-client/src/index.ts` - Export `TributaryBlob`

### TypeScript API

```typescript
class TributaryBlob {
  /**
   * Create a TributaryBlob instance for uploading/downloading blobs
   * encrypted with the given stream's read key.
   *
   * @param server - Server interface for blob storage
   * @param readKey - Uint8Array read key (stream's private key first 32 bytes),
   *                  used to derive the nacl.secretbox encryption key.
   *                  Same derivation as TributaryStream: SHA256(readKey) → 32 bytes.
   */
  constructor(server: Server, readKey: Uint8Array)

  /**
   * Encrypt and upload a blob. Returns the root hash (content address).
   *
   * Flow:
   * 1. Chunk the plaintext data into 6MB pieces
   * 2. Encrypt each chunk (nacl.secretbox with random nonce)
   * 3. Hash each encrypted chunk → leaf hashes
   * 4. Build merkle tree from leaf hashes → root hash
   * 5. Call server.initBlobUpload(rootHash, { chunkCount, totalSize, domain })
   * 6. For each chunk in order: get merkle proof,
   *    call server.uploadBlobChunk(rootHash, index, encryptedChunk, proof)
   * 7. Return root hash
   */
  async upload(data: Uint8Array, domain: string): Promise<string>

  /**
   * Download and decrypt a blob by root hash.
   * Downloads the full encrypted blob, splits into encrypted chunks
   * (using known chunk size), decrypts each, reassembles.
   * Throws if decryption fails.
   */
  async download(rootHash: string): Promise<Uint8Array>

  /**
   * Get metadata for a blob (size, domain, created date).
   */
  async getMetadata(rootHash: string): Promise<BlobMetadata | null>
}

interface BlobMetadata {
  rootHash: string
  domain: string
  size: number
  createdAt: Date
}
```

### `Server` interface additions

```typescript
interface Server {
  // ... existing methods ...

  // Blob operations
  initBlobUpload(rootHash: string, params: {
    chunkCount: number,
    totalSize: number,
    domain: string,
  }): Promise<{ tusUploadId: string }>

  uploadBlobChunk(rootHash: string, chunkIndex: number,
    data: Uint8Array, proof: string[]): Promise<boolean>

  getBlobMetadata(rootHash: string): Promise<BlobMetadata | null>

  downloadBlob(rootHash: string): Promise<Uint8Array | null>
}
```

### `FakeServer` implementation
- In-memory `Map<string, { params, chunks: Map<number, Uint8Array> }>` for in-progress uploads.
- In-memory `Map<string, { metadata: BlobMetadata, data: Uint8Array }>` for completed blobs.
- `initBlobUpload`: Stores upload params, returns fake tusUploadId.
- `uploadBlobChunk`: Verifies merkle proof against root hash (using `merkletreejs`), verifies chunk hash matches proof leaf, stores chunk. On final chunk, auto-assembles and moves to completed map.
- `downloadBlob`: Returns full assembled blob data.
- `getBlobMetadata`: Returns metadata.

### Test coverage
- Upload small blob (single chunk), download and verify round-trip
- Upload multi-chunk blob, download and verify round-trip
- Same plaintext + same key produces valid (but different) root hashes (random nonces)
- Download with wrong read key fails decryption
- FakeServer rejects chunk with bad merkle proof
- FakeServer rejects chunk with wrong data (hash mismatch)
- Metadata returns correct info after upload completes

### Estimated size: ~250 LOC code + ~200 LOC tests

---

## Key Files Reference
- `tributary-client/src/hashUtils.ts` - reuse `computeHash`, `computeHashBytes`
- `tributary-client/src/tributaryStream.ts` - encryption key derivation pattern (`SHA256(privateKey[0:32])`)
- `tributary-client/src/server.ts` - `Server` interface to extend
- `tributary-client/src/fakeServer.ts` - `FakeServer` to extend for testing
- `tributary-client/src/tributaryServer.ts` - real HTTP server implementation
- `supabase/functions/shared/crypto.ts` - server-side crypto utilities
- `supabase/functions/shared/routes.ts` - route handler pattern + `authenticateUser`
- `supabase/functions/shared/database.ts` - DB operations pattern
- `supabase/functions/stream/index.ts` - edge function entry point pattern
