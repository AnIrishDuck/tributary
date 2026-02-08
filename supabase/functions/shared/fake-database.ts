// Fake database implementation for testing
// This is a fake implementation that follows the same interface as the real Database class

import { Blob, BlobMetadata, CollectionInfo } from './models.ts';

export class FakeDatabase {
  private blobs: Map<string, Blob> = new Map();

  // Store a blob in memory
  async storeBlob(blob: Blob): Promise<boolean> {
    try {
      // Create a copy of the blob data to avoid reference issues
      const blobCopy = {
        ...blob,
        data: new Uint8Array(blob.data)
      };
      this.blobs.set(`${blob.pubkey}:${blob.id}`, blobCopy);
      return true;
    } catch (error) {
      console.error('Error storing blob in memory:', error);
      return false;
    }
  }

  // Retrieve a blob from memory
  async retrieveBlob(pubkey: string, id: string): Promise<Blob | null> {
    const key = `${pubkey}:${id}`;
    const blob = this.blobs.get(key);
    if (blob) {
      // Return a copy to avoid reference issues
      return {
        ...blob,
        data: new Uint8Array(blob.data)
      };
    }
    return null;
  }

  // Get blob metadata from memory
  async getBlobMetadata(pubkey: string, id: string): Promise<BlobMetadata | null> {
    const key = `${pubkey}:${id}`;
    const blob = this.blobs.get(key);
    if (blob) {
      // Return only the metadata fields
      return {
        id: blob.id,
        pubkey: blob.pubkey,
        hash: blob.hash,
        prior_hash: blob.prior_hash,
        signature: blob.signature,
        sequence_number: blob.sequence_number,
        created_at: blob.created_at,
        data: new Uint8Array(blob.data)
      };
    }
    return null;
  }

  // Get the latest blob for a pubkey from memory
  async getLatestBlob(pubkey: string): Promise<BlobMetadata | null> {
    let latestBlob: Blob | null = null;
    let maxSequence = -1;

    for (const blob of this.blobs.values()) {
      if (blob.pubkey === pubkey && blob.sequence_number > maxSequence) {
        latestBlob = blob;
        maxSequence = blob.sequence_number;
      }
    }

    if (latestBlob) {
      // Return only the metadata fields
      return {
        id: latestBlob.id,
        pubkey: latestBlob.pubkey,
        hash: latestBlob.hash,
        prior_hash: latestBlob.prior_hash,
        signature: latestBlob.signature,
        sequence_number: latestBlob.sequence_number,
        created_at: latestBlob.created_at,
        data: new Uint8Array(latestBlob.data)
      };
    }

    return null;
  }

  // Get collection info from memory
  async getCollectionInfo(pubkey: string): Promise<CollectionInfo> {
    const blobsForPubkey: Blob[] = [];
    
    for (const blob of this.blobs.values()) {
      if (blob.pubkey === pubkey) {
        blobsForPubkey.push(blob);
      }
    }

    if (blobsForPubkey.length === 0) {
      return {
        blob_count: 0,
        first_blob_timestamp: null,
        last_blob_timestamp: null
      };
    }

    // Sort by created_at to find first and last
    blobsForPubkey.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
    
    return {
      blob_count: blobsForPubkey.length,
      first_blob_timestamp: blobsForPubkey[0].created_at,
      last_blob_timestamp: blobsForPubkey[blobsForPubkey.length - 1].created_at
    };
  }

  // Clear all data (useful for testing)
  clear(): void {
    this.blobs.clear();
  }

  // Get all blobs for a pubkey (useful for testing)
  getAllBlobs(pubkey: string): Blob[] {
    const result: Blob[] = [];
    for (const blob of this.blobs.values()) {
      if (blob.pubkey === pubkey) {
        result.push({
          ...blob,
          data: new Uint8Array(blob.data)
        });
      }
    }
    return result;
  }
}
