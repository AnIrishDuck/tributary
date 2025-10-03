// Fake implementation of Server interface for testing
// This implementation MUST implement the same hash and signature validations as tributary-server
import { Server } from './server';

// Import tweetnacl-util functions
const util = require('tweetnacl-util');
const { encodeBase64, decodeBase64 } = util;

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
    const bodyHash = await this.computeHash(data);
    
    // Compute simple hash (priorHash + bodyHash concatenated)
    const expectedHash = `${priorHash}${bodyHash}`;
    
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
      const pubkeyBytes = decodeBase64(pubkey);
      const signatureBytes = decodeBase64(signature);
      
      // Create the data that was signed (just the concatenated hash)
      const dataToSignBytes = new TextEncoder().encode(hash);
      
      // Verify the signature using nacl
      return nacl.sign.detached.verify(dataToSignBytes, signatureBytes, pubkeyBytes);
    } catch (error) {
      return false;
    }
  }

  private async computeHash(data: Uint8Array): Promise<string> {
    // Try to use Node.js crypto if available
    try {
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256');
      hash.update(Buffer.from(data));
      const result = hash.digest('hex');
      return result;
    } catch (nodeCryptoError) {
      // Fallback to Web Crypto API
      const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
    pubkey: string
  ): Promise<Array<{
    id: string;
    pubkey: string;
    hash: string;
    priorHash: string;
    signature: string;
    sequenceNumber: number;
    createdAt: Date;
  }>> {
    // Filter blobs by pubkey and sort by sequence number
    const blobs = Array.from(this.blobs.values())
      .filter(blob => blob.pubkey === pubkey)
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    
    // Return a copy of each blob to prevent external modification
    return blobs.map(blob => ({ ...blob }));
  }
}
