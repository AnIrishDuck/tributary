// Implementation of Server interface that communicates with tributary-server
import { Server } from './server.js';
import { warn } from './logger.js';

// Import base64url functions
import * as base64url from 'urlsafe-base64';

// Import Apache Arrow for blob batch retrieval
import { tableFromIPC } from 'apache-arrow';

export class TributaryServer implements Server {
  private baseUrl: string;
  private authKey?: string;
  private writeAuthToken?: string;

  constructor(baseUrl: string, authKey?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash if present
    this.authKey = authKey;
  }

  setWriteAuthToken(token: string | undefined) {
    this.writeAuthToken = token;
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

    // Use writeAuthToken (Supabase JWT) for writes; fall back to authKey (anon key)
    if (this.writeAuthToken) {
      headers['Authorization'] = `Bearer ${this.writeAuthToken}`;
    } else if (this.authKey) {
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

  /**
   * Get multiple blobs with data in Apache Arrow IPC format
   * This is more efficient than fetching blobs one-by-one
   * 
   * @param pubkey The public key of the stream
   * @param startSequence Optional: Fetch blobs with sequence_number > this value
   * @param max Optional: Maximum number of blobs to return (default: 10)
   * @returns Array of blobs with their data and the total count
   */
  async getBlobsArrow(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{
    blobs: Array<{
      sequenceNumber: number;
      hash: string;
      data: Uint8Array;
    }>;
    totalCount: number;
  }> {
    const url = `${this.baseUrl}/${encodeURIComponent(pubkey)}/blobs`;
    
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
      
      if (!response.ok) {
        // Try to parse error as JSON
        const contentType = response.headers.get('Content-Type');
        if (contentType && contentType.includes('application/json')) {
          const errorData = await response.json();
          throw new Error(`Failed to retrieve blobs: ${response.status} - ${errorData.error || errorData.message || 'Unknown error'}`);
        } else {
          throw new Error(`Failed to retrieve blobs: ${response.status} ${response.statusText}`);
        }
      }
      
      // Get total count from header
      const totalCountHeader = response.headers.get('X-Total-Count');
      const totalCount = totalCountHeader ? parseInt(totalCountHeader, 10) : 0;
      
      // Get the Arrow IPC data
      const arrayBuffer = await response.arrayBuffer();
      const ipcBytes = new Uint8Array(arrayBuffer);
      
      // Deserialize Arrow IPC stream
      const table = tableFromIPC(ipcBytes);
      
      // Extract blobs from the table
      // Arrow schema: seq (UInt64), hash (Utf8), data (Binary)
      const blobs: Array<{
        sequenceNumber: number;
        hash: string;
        data: Uint8Array;
      }> = [];
      
      // Iterate through rows and extract data
      for (const row of table) {
        const rowData = row.toJSON();
        blobs.push({
          // Convert BigInt to number (Arrow Uint64 deserializes as BigInt)
          sequenceNumber: Number(rowData.seq),
          hash: rowData.hash,
          data: new Uint8Array(rowData.data)
        });
      }
      
      return {
        blobs,
        totalCount
      };
    } catch (error) {
      throw new Error(`Failed to retrieve blobs via Arrow: ${(error as Error).message}`);
    }
  }
}
