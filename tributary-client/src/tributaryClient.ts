// Main TributaryClient class that manages multiple streams
import { PGlite } from '@electric-sql/pglite';
import { Server } from './server.js';
import { TributaryStream, SyncStatus } from './tributaryStream.js';
import { TributaryLocal } from './tributaryLocal.js';
import { logger, warn, error, info, debug } from './logger.js';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';

export class TributaryClient {
  private pglite: PGlite;
  private server: Server;
  private streams: Map<string, TributaryStream> = new Map();
  private initialized: Promise<void>;
  private defaultStream: TributaryStream | null = null;

  constructor(options: {
    server: Server;
    db?: PGlite; // Optional existing PGlite instance
    privateKey?: string | Uint8Array; // Optional private key for default stream
    collectionId?: string; // Optional collection ID for stream
  }) {
    this.server = options.server;
    // Use provided DB or create a new one
    this.pglite = options.db || new PGlite();
    
    // Initialize the tributary schema
    this.initialized = this.initializeTributarySchema();
    
    // If privateKey is provided, create a default stream
    if (options.privateKey) {
      // Use collectionId or default to 'default'
      const appId = options.collectionId || 'default';
      // Delay stream creation until after initialization
      this.initialized = this.initialized.then(async () => {
        try {
          this.defaultStream = await this.addWriteKey(appId, options.privateKey!);
        } catch (err) {
          warn('Could not create default stream:', err as Error);
        }
      });
    }
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
    } catch (err: unknown) {
      warn('Could not initialize tributary schema:', err as Error);
    }
  }

  /**
   * Generate a schema ID based on the public key
   * For the same public key and database, this should return the same schema ID
   * @param publicKey The public key to derive the schema ID from
   * @returns A schema ID that is a valid SQL identifier
   */
  private async generateSchemaId(publicKey: Uint8Array): Promise<string> {
    // Import computeHash function
    const { computeHash } = await import('./hashUtils.js');
    
    // First check if we already have a stream with this exact public key
    try {
      const result: any = await this.pglite.query(
        `SELECT schema_id FROM tributary.streams WHERE read_key = $1`,
        [publicKey]
      );
      
      if (result.rows.length > 0) {
        // Found existing stream with same public key, return its schema ID
        return result.rows[0].schema_id;
      }
    } catch (err) {
      // If there's an error querying, continue with generated schema ID
      warn('Error checking for existing stream with same public key:', err as Error);
    }
    
    // Generate initial schema ID from public key
    const fullHash = await computeHash(publicKey);
    let schemaId = fullHash.substring(0, 16);
    
    // Check if this schema ID already exists in the database (handle potential hash collisions)
    let currentSchemaId = schemaId;
    let counter = 0;
    const MAX_ATTEMPTS = 10000; // Limit to prevent infinite loops
    
    // Limit iterations to prevent infinite loops
    while (counter < MAX_ATTEMPTS) {
      try {
        const result: any = await this.pglite.query(
          `SELECT COUNT(*) as count FROM tributary.streams WHERE schema_id = $1`,
          [currentSchemaId]
        );
        
        if (result.rows[0].count === 0) {
          break; // Found a unique schema ID
        }
      } catch (err) {
        // If there's an error querying, assume the schema ID is free
        break;
      }
      
      // Increment counter and generate a new schema ID to avoid collisions
      counter++;
      const counterBuffer = new Uint8Array(publicKey.length + 4);
      counterBuffer.set(publicKey);
      const counterBytes = new Uint8Array(4);
      new DataView(counterBytes.buffer).setUint32(0, counter, false);
      counterBuffer.set(counterBytes, publicKey.length);
      
      const counterHash = await computeHash(counterBuffer);
      currentSchemaId = counterHash.substring(0, 16);
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
    } catch (err: unknown) {
      warn('Could not list streams:', err as Error);
      return [];
    }
  }

  /**
   * Get a TributaryStream given an application ID and stream ID (url-safe base64 encoded public key))
   * For read-only access, we can create a stream with just the public key
   * @param appId Application identifier (must be a valid SQL identifier without underscores)
   * @param id URL-safe base64 encoded stream ID (public key)
   * @returns TributaryStream or undefined if not tracking that stream
   */
  async get(appId: string, id: string): Promise<TributaryStream | undefined> {
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
          appId: appId, // Use provided app ID
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
    } catch (err: unknown) {
      debug("Error retrieving stream:", err)
      warn('Could not retrieve stream:', err as Error);
    }
    
    return undefined;
  }

  /**
   * Get a TributaryLocal given an application ID and stream ID (url-safe base64 encoded public key)
   * @param appId Application identifier (must be a valid SQL identifier without underscores)
   * @param id URL-safe base64 encoded stream ID (public key)
   * @returns TributaryLocal or undefined if not tracking that stream
   */
  async getLocal(appId: string, id: string): Promise<TributaryLocal | undefined> {
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
        
        // Create a schema name using the provided app ID
        const schemaName = `${appId}_${schemaId}`;
        
        // Return a TributaryLocal instance with the correct schema
        return new TributaryLocal(this.pglite, schemaName);
      } else {
        debug('No local stream found in database for ID:', id);
      }
    } catch (err: unknown) {
      debug("Error retrieving stream:", err)
      warn('Could not retrieve local stream:', err as Error);
    }
    
    return undefined;
  }

  /**
   * Sync with server - retrieve and apply remote changes for all streams
   * @param max Maximum number of blobs to fetch per stream in this sync
   * @returns Map of stream IDs to their SyncStatus
   */
  async sync(max: number = 1000): Promise<Map<string, SyncStatus>> {
    // Wait for initialization to complete
    await this.initialized;
    
    const syncStatuses = new Map<string, SyncStatus>();
    
    // Sync all tracked streams
    for (const stream of this.streams.values()) {
      try {
        info(`Syncing stream: ${stream.getId()}`);
        const syncStatus = await stream.sync(max);
        syncStatuses.set(stream.getId(), syncStatus);
      } catch (err: unknown) {
        const errorObj = err as Error;
        error(`Failed to sync stream ${stream.getId()}:`, errorObj);
        syncStatuses.set(stream.getId(), {
          currentIndex: 0,
          finalIndex: 0,
          complete: () => false,
          error: errorObj
        });
      }
    }
    
    return syncStatuses;
  }
}
