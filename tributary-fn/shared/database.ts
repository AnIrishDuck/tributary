// Database operations for tributary-fn
// This module will handle all database operations using Supabase client

import { createClient } from '@supabase/supabase-js';
import { Blob, BlobMetadata, CollectionInfo } from './models.ts';

// Initialize Supabase client (conditionally to allow for testing)
let supabase: any = null;

// Only initialize if we have the required environment variables
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey);
}

export class Database {
  private client: any;

  constructor(supabaseUrl?: string, supabaseKey?: string) {
    if (supabaseUrl && supabaseKey) {
      // Initialize with provided credentials for testing
      this.client = createClient(supabaseUrl, supabaseKey);
    } else {
      // Use the global client for normal operation
      this.client = supabase;
    }
  }

  // Store a blob in the database
  async storeBlob(blob: Blob): Promise<boolean> {
    // Return true in test environments where supabase is not initialized
    if (!this.client) {
      console.log('Supabase not initialized, skipping storeBlob in test mode');
      return true;
    }

    const { error } = await this.client
      .from('blobs')
      .upsert({
        id: blob.id,
        pubkey: blob.pubkey,
        data: blob.data,
        hash: blob.hash,
        prior_hash: blob.prior_hash,
        signature: blob.signature,
        sequence_number: blob.sequence_number,
        created_at: blob.created_at
      }, {
        onConflict: 'pubkey,id'
      });

    if (error) {
      console.error('Database error:', error);
      return false;
    }

    return true;
  }

  // Retrieve a blob from the database
  async retrieveBlob(pubkey: string, id: string): Promise<Blob | null> {
    // Return null in test environments where supabase is not initialized
    if (!this.client) {
      console.log('Supabase not initialized, returning null in test mode');
      return null;
    }

    const { data, error } = await this.client
      .from('blobs')
      .select('*')
      .eq('pubkey', pubkey)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Database error:', error);
      return null;
    }

    return data as Blob;
  }

  // Get blob metadata from the database
  async getBlobMetadata(pubkey: string, id: string): Promise<BlobMetadata | null> {
    // Return null in test environments where supabase is not initialized
    if (!this.client) {
      console.log('Supabase not initialized, returning null in test mode');
      return null;
    }

    const { data, error } = await this.client
      .from('blobs')
      .select('id, pubkey, hash, prior_hash, signature, sequence_number, created_at, data')
      .eq('pubkey', pubkey)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Database error:', error);
      return null;
    }

    return data as BlobMetadata;
  }

  // Get the latest blob for a pubkey
  async getLatestBlob(pubkey: string): Promise<BlobMetadata | null> {
    // Return null in test environments where supabase is not initialized
    if (!this.client) {
      console.log('Supabase not initialized, returning null in test mode');
      return null;
    }

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

    return data as BlobMetadata;
  }

  // Get collection info
  async getCollectionInfo(pubkey: string): Promise<CollectionInfo> {
    // Return default values in test environments where supabase is not initialized
    if (!this.client) {
      console.log('Supabase not initialized, returning default values in test mode');
      return {
        blob_count: 0,
        first_blob_timestamp: null,
        last_blob_timestamp: null
      };
    }

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
}
