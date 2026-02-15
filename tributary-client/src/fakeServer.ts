// Fake implementation of Server interface for testing
// This implementation MUST implement the same hash and signature validations as tributary-server
import { Server } from './server';
import { computeHash } from './hashUtils';

// Import base64url functions
import * as base64url from 'urlsafe-base64';

// Import tweetnacl functions
import nacl from 'tweetnacl';

export class FakeServer implements Server {
  private blobs: Map<string, {
    id: string;
    pubkey: string;
    data: Uint8Array;
    hash: string;
    priorHash: string;
    signature: string;
    sequenceNumber: number;
    createdAt: Date;
  }> = new Map();

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
  ): Promise<{
    id: string;
    pubkey: string;
    data: Uint8Array;
    hash: string;
    priorHash: string;
    signature: string;
    sequenceNumber: number;
    createdAt: Date;
  } | null> {
    const key = `${pubkey}:${id}`;
    const blob = this.blobs.get(key);
    
    if (!blob) {
      return null;
    }
    
    return { ...blob };
  }

  // Method for testing - get all stored blobs
  getAllBlobs(): Array<{
    id: string;
    pubkey: string;
    data: Uint8Array;
    hash: string;
    priorHash: string;
    signature: string;
    sequenceNumber: number;
    createdAt: Date;
  }> {
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
      
      // Verify the signature using nacl
      return nacl.sign.detached.verify(dataToSignBytes, signatureBytes, pubkeyBytes);
    } catch (error) {
      return false;
    }
  }
  
  async getLatestBlobMetadata(
    pubkey: string
  ): Promise<{
    id: string;
    pubkey: string;
    hash: string;
    priorHash: string;
    signature: string;
    sequenceNumber: number;
    createdAt: Date;
  } | null> {
    let latestSequence = -1;
    let latestBlob: {
      id: string;
      pubkey: string;
      hash: string;
      priorHash: string;
      signature: string;
      sequenceNumber: number;
      createdAt: Date;
    } | null = null;
    
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
    blobs: Array<{
      id: string;
      pubkey: string;
      hash: string;
      priorHash: string;
      signature: string;
      sequenceNumber: number;
      createdAt: Date;
    }>;
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
}
