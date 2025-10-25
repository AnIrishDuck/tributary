// Main TributaryClient class that manages multiple streams
import { PGlite } from '@electric-sql/pglite';
import { Server } from './server';
import { TributaryStream } from './tributaryStream';
import { TributaryLocal } from './tributaryLocal';
import { logger, warn, error, info, debug } from './logger';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';

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
          schema_id TEXT UNIQUE NOT NULL,
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
   * Generate a unique schema ID based on the public key
   * @param publicKey The public key to derive the schema ID from
   * @returns A unique schema ID that is a valid SQL identifier
   */
  private async generateSchemaId(publicKey: Uint8Array): Promise<string> {
    // Import computeHash function
    const { computeHash } = await import('./hashUtils');
    
    // Hash the public key
    const fullHash = await computeHash(publicKey);
    
    // Convert hex hash to a valid SQL identifier
    let schemaId = fullHash.substring(0, 16);
    
    // Check if this schema ID already exists, if so keep hashing until we find a free one
    let currentSchemaId = schemaId;
    let counter = 0;
    const MAX_ATTEMPTS = 10000; // Limit to prevent infinite loops
    
    // Limit iterations to prevent infinite loops
    while (counter < MAX_ATTEMPTS) {
      // Check if this schema ID already exists in the database
      try {
        const result: any = await this.pglite.query(
          `SELECT COUNT(*) as count FROM tributary.streams WHERE schema_id = $1`,
          [currentSchemaId]
        );
        
        if (result.rows[0].count === 0) {
          break; // Found a unique schema ID
        }
      } catch (error) {
        // If there's an error querying, assume the schema ID is free
        break;
      }
      
      // Increment counter and generate a new schema ID
      counter++;
      const counterBuffer = new Uint8Array(publicKey.length + 4);
      counterBuffer.set(publicKey);
      const counterBytes = new Uint8Array(4);
      new DataView(counterBytes.buffer).setUint32(0, counter, false);
      counterBuffer.set(counterBytes, publicKey.length);
      
      const counterHash = await computeHash(counterBuffer);
      let counterSchemaId = counterHash.substring(0, 16);
      currentSchemaId = counterSchemaId;
    }
    
    // If we've exhausted our attempts, throw an error
    if (counter >= MAX_ATTEMPTS) {
      throw new Error(`Unable to generate unique schema ID after ${MAX_ATTEMPTS} attempts`);
    }
    
    return currentSchemaId;
  }

  /**
   * Add a stream with the given private write key
   * @param appId Application identifier (must be a valid SQL identifier without underscores)
   * @param key Private write key (base64 encoded string or Uint8Array)
   * @returns The associated TributaryStream
   */
  async addWriteKey(appId: string, key: string | Uint8Array): Promise<TributaryStream> {
    // Wait for initialization to complete
    await this.initialized;
    
    // Handle private key
    let privateKey: Uint8Array;
    if (typeof key === 'string') {
      privateKey = base64url.decode(key);
    } else {
      privateKey = new Uint8Array(key);
    }
    
    // Derive public key from private key
    // In Ed25519, the public key is the last 32 bytes of the expanded private key
    const publicKey = new Uint8Array(privateKey.slice(32));
    const streamIdStr = base64url.encode(Buffer.from(publicKey));
    
    // Check if we already have this stream
    if (this.streams.has(streamIdStr)) {
      return this.streams.get(streamIdStr)!;
    }

    // Generate schema ID from the public key
    const schemaId = await this.generateSchemaId(publicKey);
    info('Generated schema id', schemaId);
    
    // Create a new TributaryStream
    const stream = new TributaryStream({
      server: this.server,
      privateKey: privateKey,
      pglite: this.pglite,
      appId: appId,
      schemaId: schemaId
    });
    
    info('Created TributaryStream, about to initialize schema');
    
    // Initialize the stream
    await stream.initializeSchema();
    // Initialize sync state to ensure stream is saved to database
    // @ts-ignore - accessing private method for initialization
    await stream.initializeSyncState();
    
    info('Schema initialized');
    
    // Store the stream
    this.streams.set(streamIdStr, stream);
    
    // Verify the stream was added to the database
    try {
      const result: any = await this.pglite.query(
        `SELECT id FROM tributary.streams WHERE id = $1`,
        [streamIdStr]
      );
      debug('Stream verification result:', result.rows);
    } catch (e) {
      error('Error verifying stream:', e as Error);
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
   * Get a TributaryStream given a stream ID (url-safe base64 encoded public key))
   * For read-only access, we can create a stream with just the public key
   * @param id URL-safe base64 encoded stream ID (public key)
   * @returns TributaryStream or undefined if not tracking that stream
   */
  async get(id: string): Promise<TributaryStream | undefined> {
    // Wait for initialization to complete
    await this.initialized;
    
    debug('Looking for stream with ID:', id);
    
    // Check if we already have this stream in memory
    if (this.streams.has(id)) {
      debug('Found stream in memory');
      return this.streams.get(id);
    }
    
    // If not, check if it exists in the database
    try {
      debug('Querying database for stream');
      const result: any = await this.pglite.query(
        `SELECT read_key, write_key, schema_id FROM tributary.streams WHERE id = $1`,
        [id]
      );
      
      debug('Query result:', result.rows);
      
      if (result.rows.length > 0) {
        // We found the stream in the database
        // Create a stream with the available key material
        const row = result.rows[0];
        const publicKey = row.read_key; // Always use the read key for public access
        const writeKey = row.write_key; // Get the write key if available
        const schemaId = row.schema_id; // Get the schema ID
        
        debug('Creating stream with public key');

        // For now assume that we always have a write key and throw an error if we don't
        if (!writeKey) {
          throw new Error('Write key is required but not found for stream');
        }
        
        // Create a new TributaryStream with the write key
        const stream = new TributaryStream({
          server: this.server,
          privateKey: writeKey,
          pglite: this.pglite,
          appId: 'readonly', // Use a default app ID for read-only access
          schemaId: schemaId
        });
        
        debug('Created stream object, initializing');
        
        // Initialize the stream
        await stream.initializeSchema();
        
        debug('Stream initialized, storing');
        
        // Store the stream
        this.streams.set(id, stream);
        
        debug('Stream stored and returned');
        
        return stream;
      } else {
        debug('No stream found in database for ID:', id);
      }
    } catch (error: unknown) {
      debug('Error retrieving stream:', error);
      warn('Could not retrieve stream:', error as Error);
    }
    
    return undefined;
  }

  /**
   * Get a TributaryLocal given a url-safe base64 encoded id
   * @param id URL-safe base64 encoded stream ID (public key)
   * @returns TributaryLocal or undefined if not tracking that stream
   */
  async getLocal(id: string): Promise<TributaryLocal | undefined> {
    // Wait for initialization to complete
    await this.initialized;
    
    debug('Looking for local stream with ID:', id);
    
    // Check if we already have this stream in memory
    if (this.streams.has(id)) {
      return await this.streams.get(id)!.local();
    }
    
    // If not, check if it exists in the database
    try {
      debug('Querying database for local stream');
      const result: any = await this.pglite.query(
        `SELECT schema_id, id FROM tributary.streams WHERE id = $1`,
        [id]
      );
      
      debug('Query result:', result.rows);
      
      if (result.rows.length > 0) {
        // We found the stream in the database
        const row = result.rows[0];
        const schemaId = row.schema_id;
        
        // Create a schema name (using a default app ID since we don't have the original)
        const schemaName = `readonly_${schemaId}`;
        
        // Return a TributaryLocal instance with the correct schema
        return new TributaryLocal(this.pglite, schemaName);
      } else {
        debug('No local stream found in database for ID:', id);
      }
    } catch (error: unknown) {
      debug('Error retrieving local stream:', error);
      warn('Could not retrieve local stream:', error as Error);
    }
    
    return undefined;
  }
}
