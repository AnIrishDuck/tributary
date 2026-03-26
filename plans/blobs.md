# Plan: Tributary Blobs

Content-addressed immutable binary objects with merkle tree verification for multipart uploads, stored encrypted in Supabase Storage.

## Design Decisions

- **Chunk size**: 4 MB per chunk (before encryption)
- **Storage**: One Supabase Storage object per encrypted chunk, keyed by chunk hash (hash of the _encrypted_ chunk). Chunks are opaque ciphertext on the server.
- **Merkle tree**: Used as a **client-side proof mechanism** for multipart uploads — not stored in the database. The client builds the tree locally, sends chunk hashes during init, and the server verifies each chunk hash on upload. We use [`merkletreejs`](https://github.com/merkletreejs/merkletreejs) (SHA256, ~97k weekly downloads) rather than rolling our own.
- **Encryption**: Each chunk is encrypted with `nacl.secretbox` (XSalsa20-Poly1305) using an encryption key derived from the stream's read key, matching the existing stream encryption pattern. Nonce is prepended to each encrypted chunk.
- **Content addressing**: The root hash of the merkle tree (computed over encrypted chunk hashes) serves as the blob's content address. Since encryption uses a random nonce per chunk, the same plaintext produces different root hashes on each upload — this is acceptable.

---

## Prompt 1: Chunking + Merkle Helpers (`tributary-client`)

**Goal**: Thin wrapper around `merkletreejs` for chunking data, encrypting chunks, and computing the merkle root. No custom tree implementation.

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
- `getChunkProof(tree: MerkleTree, chunkHash: string): string[]` — Get proof for a specific chunk
- `verifyChunkProof(root: string, chunkHash: string, proof: string[]): boolean` — Verify a chunk belongs to the tree

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

**Goal**: Edge function endpoint for uploading and downloading encrypted blob chunks with merkle proof verification. Uses Supabase Storage as the backing store. **No database tables** — the server uses Supabase Storage directly, keyed by chunk hash.

### Files to create/modify
- **Create** `supabase/functions/blob/index.ts` - Edge function entry point
- **Create** `supabase/functions/shared/blobRoutes.ts` - Route handlers
- **Create** `supabase/functions/shared/blobModels.ts` - Type definitions
- **Modify** `supabase/functions/shared/crypto.ts` - Add `verifyMerkleRoot` (reconstruct root from chunk hashes using `merkletreejs`)

### Storage model

No database tables. The server stores:
- **Blob manifest**: Supabase Storage object at `tributary-blobs/{root_hash}/manifest.json` containing `{ chunkCount, chunkSize, totalSize, chunkHashes: string[] }`. Written once during init.
- **Chunk data**: Supabase Storage objects at `tributary-blobs/{root_hash}/{chunk_index}` containing raw encrypted bytes.

The server trusts the manifest after verifying that the chunk hashes produce the claimed root hash. On chunk upload, it verifies the uploaded data hashes to the expected chunk hash from the manifest.

### API endpoints
- `POST /blob/{root_hash}/init` — Initialize upload. Body: `{ chunkCount, chunkSize, totalSize, chunkHashes: string[] }`. Server reconstructs the merkle root from `chunkHashes` and verifies it equals `root_hash`. Stores manifest. Idempotent (re-init with same data is a no-op).
- `PUT /blob/{root_hash}/chunk/{index}` — Upload an encrypted chunk. Body: raw binary. Server hashes the body, verifies it matches `chunkHashes[index]` from the manifest. Stores in Supabase Storage.
- `GET /blob/{root_hash}` — Get blob manifest (chunk count, size, which chunks exist).
- `GET /blob/{root_hash}/chunk/{index}` — Download an encrypted chunk from Supabase Storage.
- Auth: all endpoints require Supabase JWT (same pattern as stream endpoints).

### Test coverage
- Integration tests using the route handler directly (same pattern as existing `api.test.ts`)
- Init + upload all chunks + verify manifest shows complete
- Reject init with mismatched root hash
- Reject chunk upload with wrong hash
- Idempotent init
- Download returns correct encrypted chunk data

### Estimated size: ~300 LOC code + ~200 LOC tests

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
   * Chunks the data, encrypts each chunk, builds the merkle tree,
   * inits the upload, then uploads all chunks.
   */
  async upload(data: Uint8Array): Promise<string>

  /**
   * Download and decrypt a blob by root hash. Downloads all chunks,
   * verifies the merkle root matches, decrypts each chunk, reassembles.
   * Throws if root hash doesn't match or decryption fails.
   */
  async download(rootHash: string): Promise<Uint8Array>

  /**
   * Get metadata for a blob (chunk count, total size, upload completeness).
   */
  async getMetadata(rootHash: string): Promise<BlobMetadata | null>
}

interface BlobMetadata {
  rootHash: string
  chunkCount: number
  chunkSize: number
  totalSize: number
  chunkHashes: string[]
  uploadedChunks: number[]  // indices of chunks that exist in storage
}
```

### `Server` interface additions

```typescript
interface Server {
  // ... existing methods ...

  // Blob operations
  initBlobUpload(rootHash: string, manifest: {
    chunkCount: number,
    chunkSize: number,
    totalSize: number,
    chunkHashes: string[],
  }): Promise<boolean>

  uploadBlobChunk(rootHash: string, chunkIndex: number, data: Uint8Array): Promise<boolean>

  getBlobManifest(rootHash: string): Promise<BlobManifest | null>

  downloadBlobChunk(rootHash: string, chunkIndex: number): Promise<Uint8Array | null>
}
```

### `FakeServer` implementation
- In-memory `Map<string, { manifest, chunks: Map<number, Uint8Array> }>`.
- `initBlobUpload`: Verifies merkle root from chunk hashes, stores manifest.
- `uploadBlobChunk`: Verifies chunk hash matches manifest, stores data.
- `downloadBlobChunk`: Returns stored data.
- `getBlobManifest`: Returns manifest + which chunks are uploaded.

### Test coverage
- Upload small blob (single chunk), download and verify round-trip
- Upload multi-chunk blob, download and verify round-trip
- Same plaintext + same key produces valid (but different) root hashes (random nonces)
- Download with wrong read key fails decryption
- Corrupted chunk on server fails merkle verification on download
- FakeServer correctly validates chunk hashes and rejects bad data
- Metadata returns correct upload progress

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
