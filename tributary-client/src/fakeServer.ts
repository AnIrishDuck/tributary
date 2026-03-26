// Fake implementation of Server interface for testing
// This implementation MUST implement the same hash and signature validations as tributary-server
import { Server, BlobMetadata, BlobData, ArrowBlob, ObjectBlobMetadata } from './server.js';
import { computeHash } from './hashUtils.js';
import { computeChunkHash, verifyChunkProof, type ProofEntry } from './blobHelpers.js';

// Import base64url functions
import * as base64url from 'urlsafe-base64';

// Import tweetnacl functions
import nacl from 'tweetnacl';

export class FakeServer implements Server {
  private static readonly MAX_CONFIG_ENTRIES = 64;
  private static readonly MAX_CONFIG_LENGTH = 256;

  private accountConfig: Map<string, string> = new Map();

  async getAccountConfig(): Promise<Array<{ key: string; value: string }>> {
    const entries: Array<{ key: string; value: string }> = [];
    for (const [key, value] of this.accountConfig) {
      entries.push({ key, value });
    }
    return entries;
  }

  async setAccountConfig(key: string, value: string): Promise<boolean> {
    if (key.length > FakeServer.MAX_CONFIG_LENGTH || value.length > FakeServer.MAX_CONFIG_LENGTH) {
      return false;
    }

    if (!this.accountConfig.has(key) && this.accountConfig.size >= FakeServer.MAX_CONFIG_ENTRIES) {
      return false;
    }

    this.accountConfig.set(key, value);
    return true;
  }

  async deleteAccountConfig(key: string): Promise<boolean> {
    this.accountConfig.delete(key);
    return true;
  }

  // Blob object storage (content-addressed encrypted blobs)
  private blobUploads: Map<string, {
    params: { chunkCount: number; totalSize: number; domain: string };
    chunks: Map<number, Uint8Array>;
  }> = new Map();
  private completedBlobs: Map<string, {
    metadata: ObjectBlobMetadata;
    data: Uint8Array;
  }> = new Map();

  private blobs: Map<string, BlobData> = new Map();

  async storeBlob(
    pubkey: string,
    data: Uint8Array,
    hash: string,
    priorHash: string,
    signature: string,
    sequenceNumber: number
  ): Promise<boolean> {
    // Generate ID based on pubkey and sequence number to match server behavior
    const id = `${pubkey}:${sequenceNumber}`;
    const key = `${pubkey}:${id}`;
    
    // Check if blob already exists
    if (this.blobs.has(key)) {
      return false; // Conflict
    }
    
    // Verify the signature (same validation as tributary-server)
    if (!await this.verifySignature(pubkey, signature, hash, data)) {
      throw new Error('Invalid signature');
    }
    
    // Verify the hash chaining (same validation as tributary-server)
    const computedPriorHash = this.getLatestBlobHash(pubkey);
    if (computedPriorHash !== priorHash) {
      throw new Error('Invalid prior hash');
    }
    
    // Compute body hash
    const bodyHash = await computeHash(data);
    
    // Compute chain hash as SHA256(priorHash + bodyHash) - this ensures fixed-length hashes
    const concatenated = `${priorHash}${bodyHash}`;
    const expectedHash = await computeHash(new TextEncoder().encode(concatenated));
    
    if (expectedHash !== hash) {
      throw new Error('Invalid hash');
    }
    
    // Store the blob
    this.blobs.set(key, {
      id,
      pubkey,
      data,
      hash,
      priorHash,
      signature,
      sequenceNumber,
      createdAt: new Date()
    });
    
    return true;
  }

  async retrieveBlob(
    pubkey: string,
    id: string
  ): Promise<BlobData | null> {
    const key = `${pubkey}:${id}`;
    const blob = this.blobs.get(key);
    
    if (!blob) {
      return null;
    }
    
    return { ...blob };
  }

  // Method for testing - get all stored blobs
  getAllBlobs(): BlobData[] {
    return Array.from(this.blobs.values());
  }

  private getLatestBlobHash(pubkey: string): string {
    let latestSequence = -1;
    let latestHash = '';
    
    for (const blob of this.blobs.values()) {
      if (blob.pubkey === pubkey && blob.sequenceNumber > latestSequence) {
        latestSequence = blob.sequenceNumber;
        latestHash = blob.hash;
      }
    }
    
    return latestHash;
  }

  private async verifySignature(
    pubkey: string,
    signature: string,
    hash: string,
    data: Uint8Array
  ): Promise<boolean> {
    try {
      const pubkeyBytes = base64url.decode(pubkey);
      const signatureBytes = base64url.decode(signature);
      
      // Create the data that was signed (the hash)
      const dataToSignBytes = new TextEncoder().encode(hash);
      
      // Ensure all parameters are proper Uint8Arrays (base64url.decode returns Buffer)
      const dataArray = new Uint8Array(dataToSignBytes);
      const sigArray = new Uint8Array(signatureBytes);
      const pubkeyArray = new Uint8Array(pubkeyBytes);
      
      // Verify the signature using nacl
      return nacl.sign.detached.verify(dataArray, sigArray, pubkeyArray);
    } catch (error) {
      return false;
    }
  }
  
  async getLatestBlobMetadata(
    pubkey: string
  ): Promise<BlobMetadata | null> {
    let latestSequence = -1;
    let latestBlob: BlobMetadata | null = null;
    
    for (const blob of this.blobs.values()) {
      if (blob.pubkey === pubkey && blob.sequenceNumber > latestSequence) {
        latestSequence = blob.sequenceNumber;
        latestBlob = { ...blob };
      }
    }
    
    return latestBlob;
  }
  
  async getAllBlobMetadata(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{
    blobs: BlobMetadata[];
    totalCount: number;
  }> {
    // Filter blobs by pubkey
    const blobs = Array.from(this.blobs.values())
      .filter(blob => blob.pubkey === pubkey);
    
    // Filter by sequence number if startSequence is provided
    // Note: We use > (not >=) because startSequence represents the last blob
    // that was already processed, and we want to fetch blobs AFTER that one
    let filteredBlobs = blobs;
    if (startSequence !== undefined) {
      filteredBlobs = filteredBlobs.filter(blob => blob.sequenceNumber > startSequence);
    }
    
    // Sort by sequence number
    filteredBlobs.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    // Apply limit if max is provided
    let paginatedBlobs = filteredBlobs;
    if (max !== undefined) {
      paginatedBlobs = filteredBlobs.slice(0, max);
    }
    
    // Return a copy of each blob to prevent external modification
    const resultBlobs = paginatedBlobs.map(blob => ({ ...blob }));
    
    return {
      blobs: resultBlobs,
      totalCount: blobs.length
    };
  }

  async getBlobsArrow(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{
    blobs: ArrowBlob[];
    totalCount: number;
  }> {
    // Filter blobs by pubkey
    const blobs = Array.from(this.blobs.values())
      .filter(blob => blob.pubkey === pubkey);
    
    // Filter by sequence number if startSequence is provided
    let filteredBlobs = blobs;
    if (startSequence !== undefined) {
      filteredBlobs = filteredBlobs.filter(blob => blob.sequenceNumber > startSequence);
    }
    
    // Sort by sequence number
    filteredBlobs.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    // Apply limit if max is provided (default to 10)
    const maxCount = max !== undefined ? max : 10;
    let paginatedBlobs = filteredBlobs.slice(0, maxCount);
    
    // Apply byte size limit (10MB) - same as server
    const BYTE_LIMIT = 10 * 1024 * 1024;
    let totalBytes = 0;
    const selectedBlobs = [];
    
    for (const blob of paginatedBlobs) {
      if (totalBytes + blob.data.length > BYTE_LIMIT) {
        break;
      }
      totalBytes += blob.data.length;
      selectedBlobs.push(blob);
    }
    
    // Return blobs in Arrow-compatible format (seq, hash, data)
    const resultBlobs = selectedBlobs.map(blob => ({
      sequenceNumber: blob.sequenceNumber,
      hash: blob.hash,
      data: new Uint8Array(blob.data) // Create a copy
    }));
    
    return {
      blobs: resultBlobs,
      totalCount: blobs.length
    };
  }

  // Blob object storage methods

  async initBlobUpload(rootHash: string, params: {
    chunkCount: number;
    totalSize: number;
    domain?: string;
  }): Promise<{ tusUploadUrl: string }> {
    if (this.completedBlobs.has(rootHash)) {
      throw new Error('Blob already exists');
    }
    if (this.blobUploads.has(rootHash)) {
      throw new Error('Upload already in progress');
    }
    this.blobUploads.set(rootHash, {
      params,
      chunks: new Map(),
    });
    return { tusUploadUrl: `fake-tus://upload/${rootHash}` };
  }

  async uploadBlobChunk(rootHash: string, chunkIndex: number,
    data: Uint8Array, proof: ProofEntry[]): Promise<boolean> {
    const upload = this.blobUploads.get(rootHash);
    if (!upload) {
      throw new Error('No upload session found for this root hash');
    }

    if (chunkIndex >= upload.params.chunkCount) {
      throw new Error('Chunk index out of range');
    }

    // Hash the chunk and verify the merkle proof
    const chunkHash = await computeChunkHash(data);
    if (!verifyChunkProof(rootHash, chunkHash, proof)) {
      throw new Error('Merkle proof verification failed');
    }

    upload.chunks.set(chunkIndex, new Uint8Array(data));

    // Check if upload is complete
    if (upload.chunks.size === upload.params.chunkCount) {
      // Assemble the blob in chunk order
      let totalSize = 0;
      for (let i = 0; i < upload.params.chunkCount; i++) {
        totalSize += upload.chunks.get(i)!.length;
      }
      const assembled = new Uint8Array(totalSize);
      let offset = 0;
      for (let i = 0; i < upload.params.chunkCount; i++) {
        const chunk = upload.chunks.get(i)!;
        assembled.set(chunk, offset);
        offset += chunk.length;
      }

      this.completedBlobs.set(rootHash, {
        metadata: {
          rootHash,
          domain: upload.params.domain || '',
          size: totalSize,
          chunkCount: upload.params.chunkCount,
          createdAt: new Date(),
        },
        data: assembled,
      });

      this.blobUploads.delete(rootHash);
    }

    return true;
  }

  async getBlobObjectMetadata(rootHash: string): Promise<ObjectBlobMetadata | null> {
    const blob = this.completedBlobs.get(rootHash);
    if (!blob) return null;
    return { ...blob.metadata };
  }

  async downloadBlob(rootHash: string): Promise<Uint8Array | null> {
    const blob = this.completedBlobs.get(rootHash);
    if (!blob) return null;
    return new Uint8Array(blob.data);
  }
}
