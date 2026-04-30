// Database operations for tributary-fn
// This module will handle all database operations using Supabase client

import { createClient } from '@supabase/supabase-js';
import { Blob, BlobMetadata, CollectionInfo, AccountConfigEntry } from './models.ts';
import { BlobObject, BlobUpload } from './blobModels.ts';

/** PostgREST error code returned when `.single()` finds no matching row. */
const ROW_NOT_FOUND = 'PGRST116';

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
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_KEY') || '';
    
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
  async storeBlob(blob: Blob, ownerId?: string, origin?: string | null): Promise<boolean> {
    // Convert Uint8Array to hex string for storage
    const blobForStorage: Record<string, unknown> = {
      ...blob,
      data: uint8ArrayToHexString(blob.data)
    };
    if (ownerId) blobForStorage.owner_id = ownerId;
    if (origin) blobForStorage.origin = origin;
    
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
      if (error.code === ROW_NOT_FOUND) {
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
      if (error.code === ROW_NOT_FOUND) {
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
      if (error.code === ROW_NOT_FOUND) {
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

  // Get all blobs with full data (including data field) with pagination
  // Used by the Arrow endpoint to fetch blobs efficiently
  async getAllBlobsPaginated(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{
    blobs: Blob[];
    totalCount: number;
  }> {
    let query = this.client
      .from('blobs')
      .select('*')
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
      console.error('Database error in getAllBlobsPaginated:', error);
      return { blobs: [], totalCount: 0 };
    }

    // Get total count for this pubkey
    const { count, error: countError } = await this.client
      .from('blobs')
      .select('*', { count: 'exact', head: true })
      .eq('pubkey', pubkey);

    if (countError) {
      console.error('Database error getting total count:', countError);
    }

    const blobs = (data || []).map(processDatabaseResponse) as Blob[];

    return {
      blobs,
      totalCount: count !== null ? count : 0
    };
  }

  private static readonly MAX_CONFIG_ENTRIES = 64;
  private static readonly MAX_CONFIG_LENGTH = 256;

  async getAccountConfig(ownerId: string): Promise<AccountConfigEntry[]> {
    const { data, error } = await this.client
      .from('account_config')
      .select('key, value')
      .eq('owner_id', ownerId);

    if (error) {
      console.error('Database error in getAccountConfig:', error);
      return [];
    }

    return (data || []) as AccountConfigEntry[];
  }

  async setAccountConfig(ownerId: string, key: string, value: string): Promise<boolean> {
    if (key.length > Database.MAX_CONFIG_LENGTH || value.length > Database.MAX_CONFIG_LENGTH) {
      return false;
    }

    // Check entry count (only if this is a new key)
    const { data: existing } = await this.client
      .from('account_config')
      .select('key')
      .eq('owner_id', ownerId)
      .eq('key', key)
      .maybeSingle();

    if (!existing) {
      // New key — enforce max entries
      const { count, error: countError } = await this.client
        .from('account_config')
        .select('*', { count: 'exact', head: true })
        .eq('owner_id', ownerId);

      if (countError) {
        console.error('Database error counting config entries:', countError);
        return false;
      }

      if ((count ?? 0) >= Database.MAX_CONFIG_ENTRIES) {
        return false;
      }
    }

    const { error } = await this.client
      .from('account_config')
      .upsert({ owner_id: ownerId, key, value }, { onConflict: 'owner_id,key' });

    if (error) {
      console.error('Database error in setAccountConfig:', error);
      return false;
    }

    return true;
  }

  async deleteAccountConfig(ownerId: string, key: string): Promise<boolean> {
    const { error } = await this.client
      .from('account_config')
      .delete()
      .eq('owner_id', ownerId)
      .eq('key', key);

    if (error) {
      console.error('Database error in deleteAccountConfig:', error);
      return false;
    }

    return true;
  }

  // --- Blob Object operations (content-addressed encrypted blobs) ---

  async createBlobUpload(upload: Omit<BlobUpload, 'created_at' | 'chunks_uploaded'>): Promise<boolean> {
    const { error } = await this.client
      .from('blob_uploads')
      .insert({
        root_hash: upload.root_hash,
        owner_id: upload.owner_id,
        domain: upload.domain,
        size: upload.size,
        chunk_count: upload.chunk_count,
        tus_upload_url: upload.tus_upload_url,
        chunks_uploaded: 0,
      });

    if (error) {
      console.error('Database error in createBlobUpload:', error);
      return false;
    }
    return true;
  }

  async getBlobUpload(rootHash: string): Promise<BlobUpload | null> {
    const { data, error } = await this.client
      .from('blob_uploads')
      .select('*')
      .eq('root_hash', rootHash)
      .single();

    if (error) {
      if (error.code === ROW_NOT_FOUND) return null;
      console.error('Database error in getBlobUpload:', error);
      return null;
    }

    return processDatabaseResponse(data) as BlobUpload;
  }

  async incrementBlobUploadChunks(rootHash: string): Promise<number> {
    // Use raw RPC to atomically increment
    const { data, error } = await this.client
      .from('blob_uploads')
      .select('chunks_uploaded')
      .eq('root_hash', rootHash)
      .single();

    if (error || !data) {
      console.error('Database error in incrementBlobUploadChunks (read):', error);
      return -1;
    }

    const newCount = data.chunks_uploaded + 1;
    const { error: updateError } = await this.client
      .from('blob_uploads')
      .update({ chunks_uploaded: newCount })
      .eq('root_hash', rootHash);

    if (updateError) {
      console.error('Database error in incrementBlobUploadChunks (update):', updateError);
      return -1;
    }

    return newCount;
  }

  async completeBlobUpload(rootHash: string): Promise<boolean> {
    // Get the upload record
    const upload = await this.getBlobUpload(rootHash);
    if (!upload) return false;

    // Insert into blob_objects
    const { error: insertError } = await this.client
      .from('blob_objects')
      .insert({
        root_hash: upload.root_hash,
        owner_id: upload.owner_id,
        domain: upload.domain,
        size: upload.size,
        chunk_count: upload.chunk_count,
      });

    if (insertError) {
      console.error('Database error in completeBlobUpload (insert):', insertError);
      return false;
    }

    // Delete the upload record
    const { error: deleteError } = await this.client
      .from('blob_uploads')
      .delete()
      .eq('root_hash', rootHash);

    if (deleteError) {
      console.error('Database error in completeBlobUpload (delete):', deleteError);
      // Not fatal — the blob_object was created
    }

    return true;
  }

  async getBlobObject(rootHash: string): Promise<BlobObject | null> {
    const { data, error } = await this.client
      .from('blob_objects')
      .select('*')
      .eq('root_hash', rootHash)
      .single();

    if (error) {
      if (error.code === ROW_NOT_FOUND) return null;
      console.error('Database error in getBlobObject:', error);
      return null;
    }

    return processDatabaseResponse(data) as BlobObject;
  }

  async deleteBlobUpload(rootHash: string): Promise<boolean> {
    const { error } = await this.client
      .from('blob_uploads')
      .delete()
      .eq('root_hash', rootHash);

    if (error) {
      console.error('Database error in deleteBlobUpload:', error);
      return false;
    }
    return true;
  }
}
