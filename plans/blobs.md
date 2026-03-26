# Plan: Tributary Blobs

Content-addressed immutable binary objects with merkle-tree-verified multipart uploads, stored encrypted as single objects in Supabase Storage.

## Design Decisions

- **Chunk size**: 4 MB per chunk (before encryption)
- **Storage**: One Supabase Storage object per blob, keyed by the blob's root hash. Chunks are assembled server-side into a single object during multipart upload.
- **Merkle tree**: Used as the **multipart upload verification protocol**. The client builds the tree locally from encrypted chunk hashes. Each chunk upload includes the merkle proof (sibling hashes back to the root) so the server can independently verify every chunk belongs to the claimed blob before accepting it. We use [`merkletreejs`](https://github.com/merkletreejs/merkletreejs) (SHA256, ~97k weekly downloads) rather than rolling our own.
- **Database**: Simple `blobs` metadata table tracking creator, domain, size, and hash. No chunk-level tracking — the merkle tree is ephemeral to the upload process.
- **Encryption**: Each chunk is encrypted with `nacl.secretbox` (XSalsa20-Poly1305) using an encryption key derived from the stream's read key, matching the existing stream encryption pattern. Nonce is prepended to each encrypted chunk.
- **Content addressing**: The root hash of the merkle tree (computed over encrypted chunk hashes) serves as the blob's content address. Since encryption uses a random nonce per chunk, the same plaintext produces different root hashes on each upload — this is acceptable.

---

## Prompt 1: Chunking + Merkle Helpers (`tributary-client`)

**Goal**: Thin wrapper around `merkletreejs` for chunking data, encrypting chunks, computing the merkle root, and generating/verifying proofs. No custom tree implementation.

### Files to create/modify
- **Create** `tributary-client/src/blobHelpers.ts` - Chunking, encryption, merkle helpers
- **Create** `tributary-client/test/blob-helpers.test.ts` - Tests
- **Modify** `tributary-client/package.json` - Add `merkletreejs` dependency

### What to implement
- `CHUNK_SIZE = 4 * 1024 * 1024` (4MB)
- `chunkData(data: Uint8Array): Uint8Array[]` — Split data into ≤ CHUNK_SIZE pieces
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

**Goal**: Edge function endpoint for multipart upload of encrypted blobs with per-chunk merkle proof verification. Each blob is stored as a single Supabase Storage object, assembled from verified chunks. Blob metadata is tracked in a simple database table.

### Files to create/modify
- **Create** `supabase/functions/blob/index.ts` - Edge function entry point
- **Create** `supabase/functions/shared/blobRoutes.ts` - Route handlers
- **Create** `supabase/functions/shared/blobModels.ts` - Type definitions
- **Create** `supabase/migrations/YYYYMMDD_blobs.sql` - Migration for blobs metadata table
- **Modify** `supabase/functions/shared/crypto.ts` - Add `verifyMerkleProof` (verify a chunk hash + proof against a root using `merkletreejs`)

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

### Storage model

- **One Supabase Storage object per blob** at `tributary-blobs/{root_hash}` containing the full encrypted blob data.
- During multipart upload, the server assembles chunks into the final object. Each chunk upload includes the merkle proof so the server can verify the chunk belongs to the claimed root hash before accepting it.
- The server does **not** persist the merkle tree or chunk manifest. The tree is ephemeral — it exists only during the upload process.

### API endpoints
- `POST /blob/{root_hash}/init` — Initialize a multipart upload. Body: `{ chunkCount, chunkSize, totalSize, domain }`. Server creates upload session state (in-memory or temporary storage). Returns upload ID.
- `PUT /blob/{root_hash}/chunk/{index}` — Upload an encrypted chunk. Body: raw binary. Headers: `X-Merkle-Proof` (JSON array of sibling hashes). Server hashes the chunk, verifies the proof against `root_hash`, and accepts the chunk. Server appends/stores chunk data for later assembly.
- `POST /blob/{root_hash}/finalize` — Finalize the upload. Server assembles all chunks into a single Storage object at `tributary-blobs/{root_hash}`, inserts the `blobs` DB row, and cleans up temporary state.
- `GET /blob/{root_hash}` — Get blob metadata from the `blobs` table.
- `GET /blob/{root_hash}/data` — Download the full encrypted blob from Supabase Storage. Supports HTTP Range requests for partial reads.
- Auth: all endpoints require Supabase JWT (same pattern as stream endpoints).

### Test coverage
- Integration tests using the route handler directly (same pattern as existing `api.test.ts`)
- Init + upload all chunks + finalize → blob exists in storage and DB
- Reject chunk with invalid merkle proof
- Reject chunk with hash that doesn't match proof
- Idempotent init
- Download returns correct full encrypted blob
- Metadata returns correct blob info

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
   * 1. Chunk the plaintext data
   * 2. Encrypt each chunk (nacl.secretbox with random nonce)
   * 3. Hash each encrypted chunk → leaf hashes
   * 4. Build merkle tree from leaf hashes → root hash
   * 5. Call server.initBlobUpload(rootHash, { chunkCount, chunkSize, totalSize, domain })
   * 6. For each chunk: get merkle proof, call server.uploadBlobChunk(rootHash, index, data, proof)
   * 7. Call server.finalizeBlobUpload(rootHash)
   * 8. Return root hash
   */
  async upload(data: Uint8Array, domain: string): Promise<string>

  /**
   * Download and decrypt a blob by root hash.
   * Downloads the full encrypted blob, splits into chunks, decrypts each.
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
    chunkSize: number,
    totalSize: number,
    domain: string,
  }): Promise<boolean>

  uploadBlobChunk(rootHash: string, chunkIndex: number,
    data: Uint8Array, proof: string[]): Promise<boolean>

  finalizeBlobUpload(rootHash: string): Promise<boolean>

  getBlobMetadata(rootHash: string): Promise<BlobMetadata | null>

  downloadBlob(rootHash: string): Promise<Uint8Array | null>
}
```

### `FakeServer` implementation
- In-memory `Map<string, { params, chunks: Map<number, Uint8Array> }>` for in-progress uploads.
- In-memory `Map<string, { metadata: BlobMetadata, data: Uint8Array }>` for finalized blobs.
- `initBlobUpload`: Stores upload params.
- `uploadBlobChunk`: Verifies merkle proof against root hash (using `merkletreejs`), verifies chunk hash matches proof leaf, stores chunk.
- `finalizeBlobUpload`: Assembles chunks into single blob, inserts metadata, clears upload state.
- `downloadBlob`: Returns full assembled blob data.
- `getBlobMetadata`: Returns metadata.

### Test coverage
- Upload small blob (single chunk), download and verify round-trip
- Upload multi-chunk blob, download and verify round-trip
- Same plaintext + same key produces valid (but different) root hashes (random nonces)
- Download with wrong read key fails decryption
- FakeServer rejects chunk with bad merkle proof
- FakeServer rejects chunk with wrong data (hash mismatch)
- Metadata returns correct info after finalization

### Estimated size: ~250 LOC code + ~200 LOC tests

---

## Key Files Reference
- `tributary-client/src/hashUtils.ts` - reuse `computeHash`, `computeHashBytes`
- `tributary-client/src/tributaryStream.ts` - encryption key derivation pattern (`SHA256(privateKey[0:32])`)
- `tributary-client/src/server.ts` - `Server` interface to extend
- `tributary-client/src/fakeServer.ts` - `FakeServer` to extend for testing
- `tributary-client/src/tributaryServer.ts` - real HTTP server implementation
- `supabase/functions/shared/crypto.ts` - server-side crypto utilities
- `supabase/functions/shared/routes.ts` - pattern for route handlers
- `supabase/functions/shared/database.ts` - pattern for DB operations
