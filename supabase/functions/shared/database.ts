// Database operations for tributary-fn
// This module will handle all database operations using Supabase client

import { createClient } from '@supabase/supabase-js';
import { Blob, BlobMetadata, CollectionInfo } from './models.ts';

// Helper function to convert hex string to Uint8Array
function hexStringToUint8Array(hexString: string): Uint8Array {
  // Remove the \x prefix if present
  if (hexString.startsWith('\\x')) {
    hexString = hexString.substring(2);
  }
  
  const bytes = new Uint8Array(hexString.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hexString.substr(i * 2, 2), 16);
  }
  return bytes;
}

// Helper function to convert Uint8Array to hex string for storage
function uint8ArrayToHexString(uint8Array: Uint8Array): string {
  return '\\x' + Array.from(uint8Array)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

// Helper function to process database response data
function processDatabaseResponse(data: any): any {
  if (!data) return data;
  
  // Convert hex string back to Uint8Array
  if (data && typeof data.data === 'string') {
    data.data = hexStringToUint8Array(data.data);
  }
  
  // Convert created_at string to Date object if needed
  if (data && typeof data.created_at === 'string') {
    data.created_at = new Date(data.created_at);
  }
  
  return data;
}

export class Database {
  private client: any;

  constructor(noSessions: boolean = false) {
    // Always connect using DATABASE_URL as SUPABASE_URL
    // In local development, this will be set to the local Supabase instance
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    
    let clientOptions = {};
    
    // Set options to prevent connection leaks in tests only when noSessions is true
    if (noSessions) {
      clientOptions = {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
        global: {
          headers: {
            'X-Client-Info': 'tributary-fn-test'
          }
        }
      };
    }
    
    // Initialize with provided credentials and options
    this.client = createClient(supabaseUrl, supabaseKey, clientOptions);
  }

  // Store a blob in the database
  async storeBlob(blob: Blob): Promise<boolean> {
    // Convert Uint8Array to hex string for storage
    const blobForStorage = {
      ...blob,
      data: uint8ArrayToHexString(blob.data)
    };
    
    const { error } = await this.client
      .from('blobs')
      .upsert(blobForStorage, {
        onConflict: 'pubkey,id'
      });

    if (error) {
      console.error('Database error in storeBlob:', error);
      return false;
    }

    return true;
  }

  // Retrieve a blob from the database
  async retrieveBlob(pubkey: string, id: string): Promise<Blob | null> {
    const { data, error } = await this.client
      .from('blobs')
      .select('*')
      .eq('pubkey', pubkey)
      .eq('id', id)
      .single();

    if (error) {
      // Return null if not found (not an error)
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Database error:', error);
      return null;
    }

    return processDatabaseResponse(data) as Blob;
  }

  // Get blob metadata from the database
  async getBlobMetadata(pubkey: string, id: string): Promise<BlobMetadata | null> {
    const { data, error } = await this.client
      .from('blobs')
      .select('id, pubkey, hash, prior_hash, signature, sequence_number, created_at, data')
      .eq('pubkey', pubkey)
      .eq('id', id)
      .single();

    if (error) {
      // Return null if not found (not an error)
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Database error:', error);
      return null;
    }

    return processDatabaseResponse(data) as BlobMetadata;
  }

  // Get the latest blob for a pubkey
  async getLatestBlob(pubkey: string): Promise<BlobMetadata | null> {
    const { data, error } = await this.client
      .from('blobs')
      .select('id, pubkey, hash, prior_hash, signature, sequence_number, created_at, data')
      .eq('pubkey', pubkey)
      .order('sequence_number', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      // Return null if no blobs found (not an error)
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('Database error:', error);
      return null;
    }

    return processDatabaseResponse(data) as BlobMetadata;
  }

  // Get collection info
  async getCollectionInfo(pubkey: string): Promise<CollectionInfo> {
    const { data, error } = await this.client
      .from('blobs')
      .select('created_at')
      .eq('pubkey', pubkey)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Database error:', error);
      return {
        blob_count: 0,
        first_blob_timestamp: null,
        last_blob_timestamp: null
      };
    }

    const blob_count = data.length;
    const first_blob_timestamp = blob_count > 0 ? new Date(data[0].created_at) : null;
    const last_blob_timestamp = blob_count > 0 ? new Date(data[data.length - 1].created_at) : null;

    return {
      blob_count,
      first_blob_timestamp,
      last_blob_timestamp
    };
  }

  // Get blob metadata with pagination
  async getAllBlobMetadataPaginated(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{ blobs: BlobMetadata[]; total_count: number }> {
    let query = this.client
      .from('blobs')
      .select('id, pubkey, hash, prior_hash, signature, sequence_number, created_at, data')
      .eq('pubkey', pubkey)
      .order('sequence_number', { ascending: true });

    // Filter by sequence number if startSequence is provided
    // Note: We use > (not >=) because startSequence represents the last blob
    // that was already processed, and we want to fetch blobs AFTER that one
    if (startSequence !== undefined) {
      query = query.gt('sequence_number', startSequence);
    }

    // Apply limit if max is provided
    if (max !== undefined) {
      query = query.limit(max);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Database error in getAllBlobMetadataPaginated:', error);
      return { blobs: [], total_count: 0 };
    }

    // Get total count
    const { count, error: countError } = await this.client
      .from('blobs')
      .select('*', { count: 'exact', head: true })
      .eq('pubkey', pubkey);

    if (countError) {
      console.error('Database error getting total count:', countError);
    }

    const blobs = (data || []).map(processDatabaseResponse) as BlobMetadata[];

    return {
      blobs,
      total_count: count !== null ? count : 0
    };
  }
}
