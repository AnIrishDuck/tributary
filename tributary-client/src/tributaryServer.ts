// Implementation of Server interface that communicates with tributary-server
import { Server } from './server.js';
import { warn } from './logger.js';

// Import base64url functions
import * as base64url from 'urlsafe-base64';

export class TributaryServer implements Server {
  private baseUrl: string;
  private authKey?: string;

  constructor(baseUrl: string, authKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash if present
    this.authKey = authKey;
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
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-Tributary-Hash': hash, // Send the concatenated hash
      'X-Tributary-Authorization': signature
    };
    
    // Add auth header if authKey is provided
    if (this.authKey) {
      headers['Authorization'] = `Bearer ${this.authKey}`;
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers,
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
    
    const headers: Record<string, string> = {};
    
    // Add auth header if authKey is provided
    if (this.authKey) {
      headers['Authorization'] = `Bearer ${this.authKey}`;
    }
    
    const response = await fetch(url, { headers });
    
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
    
    const headers: Record<string, string> = {};
    
    // Add auth header if authKey is provided
    if (this.authKey) {
      headers['Authorization'] = `Bearer ${this.authKey}`;
    }
    
    try {
      const response = await fetch(url, { headers });
      
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
   * This uses the new /all endpoint with pagination support
   */
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
    const url = `${this.baseUrl}/${encodeURIComponent(pubkey)}/all`;
    
    const params = new URLSearchParams();
    if (startSequence !== undefined) {
      params.set('start_sequence', startSequence.toString());
    }
    if (max !== undefined) {
      params.set('max', max.toString());
    }
    
    const urlString = params.toString() 
      ? `${url}?${params.toString()}`
      : url;
    
    const headers: Record<string, string> = {};
    
    // Add auth header if authKey is provided
    if (this.authKey) {
      headers['Authorization'] = `Bearer ${this.authKey}`;
    }
    
    try {
      const response = await fetch(urlString, { headers });
      
      if (response.ok) {
        const result = await response.json();
        
        const blobs = result.blobs.map((blob: any) => ({
          id: blob.id,
          pubkey: blob.pubkey,
          hash: blob.hash,
          priorHash: blob.prior_hash,
          signature: blob.signature,
          sequenceNumber: blob.sequence_number,
          createdAt: new Date(blob.created_at)
        }));
        
        return {
          blobs,
          totalCount: result.total_count
        };
      } else {
        throw new Error(`Failed to retrieve blob metadata: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      throw new Error(`Failed to retrieve blob metadata: ${(error as Error).message}`);
    }
  }
}
