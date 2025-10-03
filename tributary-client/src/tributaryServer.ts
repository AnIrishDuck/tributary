// Implementation of Server interface that communicates with tributary-server
import { Server } from './server';
import { warn } from './logger';

// Import tweetnacl-util functions
const util = require('tweetnacl-util');
const { encodeBase64, decodeBase64 } = util;

export class TributaryServer implements Server {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash if present
  }

  async storeBlob(
    pubkey: string,
    data: Uint8Array,
    hash: string,
    priorHash: string,
    signature: string,
    sequenceNumber: number
  ): Promise<boolean> {
    // The server now auto-generates IDs based on pubkey and sequence number
    // We don't send the ID in the URL anymore, just the pubkey
    const url = `${this.baseUrl}/${encodeURIComponent(pubkey)}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Tributary-Hash': hash, // Send the concatenated hash
        'X-Tributary-Authorization': signature
      },
      body: data as any
    });

    if (response.ok) {
      return true;
    } else if (response.status === 409) {
      // Conflict - blob already exists
      return false;
    } else {
      const errorText = await response.text();
      throw new Error(`Failed to store blob: ${response.status} ${response.statusText} - ${errorText}`);
    }
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
    const url = `${this.baseUrl}/${encodeURIComponent(pubkey)}/${encodeURIComponent(id)}`;
    
    const response = await fetch(url);
    
    if (response.ok) {
      const blob = await response.json();
      
      // Convert data from array of numbers to Uint8Array
      const data = new Uint8Array(blob.data);
      
      return {
        id: blob.id,
        pubkey: blob.pubkey,
        data,
        hash: blob.hash,
        priorHash: blob.prior_hash,
        signature: blob.signature,
        sequenceNumber: blob.sequence_number,
        createdAt: new Date(blob.created_at)
      };
    } else if (response.status === 404) {
      return null;
    } else {
      throw new Error(`Failed to retrieve blob: ${response.status} ${response.statusText}`);
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
    const url = `${this.baseUrl}/${encodeURIComponent(pubkey)}/latest`;
    
    try {
      const response = await fetch(url);
      
      if (response.ok) {
        const blob = await response.json();
        
        return {
          id: blob.id,
          pubkey: blob.pubkey,
          hash: blob.hash,
          priorHash: blob.prior_hash,
          signature: blob.signature,
          sequenceNumber: blob.sequence_number,
          createdAt: new Date(blob.created_at)
        };
      } else if (response.status === 404) {
        // No blobs found for this pubkey, return null
        return null;
      } else {
        throw new Error(`Failed to retrieve latest blob metadata: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      throw new Error(`Failed to retrieve latest blob metadata: ${(error as Error).message}`);
    }
  }
  
  /**
   * Get all blob metadata for a given public key, ordered by sequence number
   * This is a simplified implementation that assumes sequential numbering starts at 1
   */
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
    // First get the latest blob to determine the highest sequence number
    const latestBlob = await this.getLatestBlobMetadata(pubkey);
    
    if (!latestBlob) {
      return [];
    }
    
    const maxSequenceNumber = latestBlob.sequenceNumber;
    const blobMetadataList: Array<{
      id: string;
      pubkey: string;
      hash: string;
      priorHash: string;
      signature: string;
      sequenceNumber: number;
      createdAt: Date;
    }> = [];
    
    // Try to fetch each blob from 1 to maxSequenceNumber
    // This assumes sequential numbering with no gaps
    for (let seq = 1; seq <= maxSequenceNumber; seq++) {
      try {
        const blobId = `${pubkey}:${seq}`;
        const url = `${this.baseUrl}/${encodeURIComponent(pubkey)}/${encodeURIComponent(blobId)}`;
        
        const response = await fetch(url);
        
        if (response.ok) {
          const blob = await response.json();
          
          blobMetadataList.push({
            id: blob.id,
            pubkey: blob.pubkey,
            hash: blob.hash,
            priorHash: blob.prior_hash,
            signature: blob.signature,
            sequenceNumber: blob.sequence_number,
            createdAt: new Date(blob.created_at)
          });
        }
        // If 404, just continue (blob doesn't exist or numbering isn't sequential)
      } catch (error) {
        // Continue with next sequence number on error
        warn(`Failed to fetch blob ${seq}:`, (error as Error).message);
      }
    }
    
    // Sort by sequence number to ensure proper order
    return blobMetadataList.sort((a, b) => a.sequenceNumber - b.sequenceNumber);
  }
}
