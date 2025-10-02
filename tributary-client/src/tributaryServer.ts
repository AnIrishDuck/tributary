// Implementation of Server interface that communicates with tributary-server
import { Server } from './server';

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
    id: string,
    data: Uint8Array,
    hash: string,
    priorHash: string,
    signature: string,
    sequenceNumber: number
  ): Promise<boolean> {
    const url = `${this.baseUrl}/${encodeURIComponent(pubkey)}/${encodeURIComponent(id)}`;
    
    // Compute body hash (SHA256 of the data)
    const bodyHash = await this.computeHash(data);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Tributary-Hash': bodyHash,
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
      throw new Error(`Failed to store blob: ${response.status} ${response.statusText}`);
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

  private async computeHash(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
