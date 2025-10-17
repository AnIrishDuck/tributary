// Main TributaryClient class that manages multiple streams
import { PGlite } from '@electric-sql/pglite';
import { Server } from './server';
import { TributaryStream } from './tributaryStream';
import { logger, warn, error, info, debug } from './logger';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

export class TributaryClient {
  private pglite: PGlite;
  private server: Server;
  private streams: Map<string, TributaryStream> = new Map();
  private initialized: Promise<void>;

  constructor(options: {
    server: Server;
    db?: PGlite; // Optional existing PGlite instance
  }) {
    this.server = options.server;
    // Use provided DB or create a new one
    this.pglite = options.db || new PGlite();
    
    // Initialize the tributary schema
    this.initialized = this.initializeTributarySchema();
  }

  /**
   * Initialize the tributary schema for internal state tracking
   */
  private async initializeTributarySchema(): Promise<void> {
    try {
      // Create the tributary schema if it doesn't exist
      await this.pglite.exec(`CREATE SCHEMA IF NOT EXISTS tributary`);
      
      // Create the streams table for tracking stream state
      await this.pglite.exec(
        `CREATE TABLE IF NOT EXISTS tributary.streams (
          id TEXT PRIMARY KEY,
          read_key BYTEA NOT NULL,
          write_key BYTEA,
          last_sync_index INTEGER
        )`
      );
    } catch (error: unknown) {
      warn('Could not initialize tributary schema:', error as Error);
    }
  }

  /**
   * Add a stream with the given private write key
   * @param key Private write key (base64 encoded string or Uint8Array)
   * @param appId Application identifier (must be a valid SQL identifier without underscores)
   * @param streamId Stream identifier
   * @returns The associated TributaryStream
   */
  async addWriteKey(key: string | Uint8Array, appId: string, streamId: string): Promise<TributaryStream> {
    // Wait for initialization to complete
    await this.initialized;
    
    // Handle private key
    let privateKey: Uint8Array;
    if (typeof key === 'string') {
      privateKey = decodeBase64(key);
    } else {
      privateKey = key;
    }
    
    // Derive public key from private key
    // In Ed25519, the public key is the last 32 bytes of the expanded private key
    const publicKey = privateKey.slice(32);
    const streamIdStr = encodeBase64(publicKey);
    
    // Check if we already have this stream
    if (this.streams.has(streamIdStr)) {
      return this.streams.get(streamIdStr)!;
    }
    
    // Create a new TributaryStream
    const stream = new TributaryStream({
      server: this.server,
      privateKey: privateKey,
      pglite: this.pglite,
      appId: appId,
      streamId: streamId
    });
    
    console.log('Created TributaryStream, about to initialize schema');
    
    // Initialize the stream
    await stream.initializeSchema();
    
    console.log('Schema initialized');
    
    // Store the stream
    this.streams.set(streamIdStr, stream);
    
    // Verify the stream was added to the database
    try {
      const result: any = await this.pglite.query(
        `SELECT id FROM tributary.streams WHERE id = $1`,
        [streamIdStr]
      );
      console.log('Stream verification result:', result.rows);
    } catch (error) {
      console.error('Error verifying stream:', error);
    }
    
    return stream;
  }

  /**
   * List all TributaryStream objects tracked locally
   * @returns Array of stream IDs
   */
  async list(): Promise<string[]> {
    // Wait for initialization to complete
    await this.initialized;
    
    try {
      // Query the tributary.streams table to get all stream IDs
      const result: any = await this.pglite.query(
        `SELECT id FROM tributary.streams`
      );
      
      return result.rows.map((row: any) => row.id);
    } catch (error: unknown) {
      warn('Could not list streams:', error as Error);
      return [];
    }
  }

  /**
   * Get a TributaryStream given a url-safe base64 encoded id
   * For read-only access, we can create a stream with just the public key
   * @param id URL-safe base64 encoded stream ID (public key)
   * @returns TributaryStream or undefined if not tracking that stream
   */
  async get(id: string): Promise<TributaryStream | undefined> {
    // Wait for initialization to complete
    await this.initialized;
    
    console.log('DEBUG: Looking for stream with ID:', id);
    
    // Check if we already have this stream in memory
    if (this.streams.has(id)) {
      console.log('DEBUG: Found stream in memory');
      return this.streams.get(id);
    }
    
    // If not, check if it exists in the database
    try {
      console.log('DEBUG: Querying database for stream');
      const result: any = await this.pglite.query(
        `SELECT read_key, write_key FROM tributary.streams WHERE id = $1`,
        [id]
      );
      
      console.log('DEBUG: Query result:', result.rows);
      
      if (result.rows.length > 0) {
        // We found the stream in the database
        // Create a stream with the available key material
        const row = result.rows[0];
        const publicKey = row.read_key; // Always use the read key for public access
        
        console.log('DEBUG: Creating stream with public key');
        
        // Create a minimal stream for read-only access
        // We'll create a dummy private key since the stream will only be used for reads
        // For read operations, private key is not needed, but we still need to pass one
        const dummyPrivateKey = new Uint8Array(64);
        // Fill with zeros for the first 32 bytes (private part)
        // Set the public key in the second 32 bytes
        dummyPrivateKey.set(publicKey, 32);
        
        // Create a new TributaryStream with the public key
        const stream = new TributaryStream({
          server: this.server,
          privateKey: dummyPrivateKey,
          pglite: this.pglite,
          appId: 'readonly', // Use a default app ID for read-only access
          streamId: id
        });
        
        console.log('DEBUG: Created stream object, initializing');
        
        // Initialize the stream
        await stream.initializeSchema();
        
        console.log('DEBUG: Stream initialized, storing');
        
        // Store the stream
        this.streams.set(id, stream);
        
        console.log('DEBUG: Stream stored and returned');
        
        return stream;
      } else {
        console.log('DEBUG: No stream found in database for ID:', id);
      }
    } catch (error: unknown) {
      console.log('DEBUG: Error retrieving stream:', error);
      warn('Could not retrieve stream:', error as Error);
    }
    
    return undefined;
  }
}
