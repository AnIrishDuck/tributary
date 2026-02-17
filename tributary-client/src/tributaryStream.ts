// TributaryStream class for managing individual streams
import { PGlite } from '@electric-sql/pglite';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';
import { Server } from './server.js';
import { TributaryLocal } from './tributaryLocal.js';
import { logger, warn, error, info, debug } from './logger.js';
import { computeHash } from './hashUtils.js';

// Type definitions for our transaction log
interface TransactionLogEntry {
  id: string;
  timestamp: number;
  query: string;
  params?: any[];
  result?: any;
}

export class TributaryStream {
  private pglite: PGlite;
  private server: Server;
  private privateKey: Uint8Array;
  private publicKey: Uint8Array;
  private sequenceNumber: number = 0;
  private latestHash: string = ''; // Track the latest hash for chaining
  private lastSyncIndex: number = 0;
  private syncStateInitialized: boolean = false;
  private appId: string;
  private schemaId: string;
  private schemaName: string;

  constructor(options: {
    server: Server;
    privateKey: Uint8Array;
    pglite: PGlite;
    appId: string;
    schemaId: string;
  }) {
    this.server = options.server;
    // Ensure privateKey is a proper Uint8Array, not a Buffer
    this.privateKey = new Uint8Array(options.privateKey);
    // In Ed25519, the public key is the last 32 bytes of the expanded private key
    // Ensure publicKey is also a proper Uint8Array
    this.publicKey = new Uint8Array(this.privateKey.slice(32));
    this.pglite = options.pglite;
    this.appId = options.appId;
    this.schemaId = options.schemaId;
    // Quote the schema name to handle special characters
    this.schemaName = `"${this.appId}_${this.schemaId}"`;
    debug("schemaName", this.schemaName);
  }

  getId(): string {
    return base64url.encode(Buffer.from(this.publicKey));
  }

  /**
   * Get the schema name for this stream
   */
  getSchemaName(): string {
    return this.schemaName;
  }

  /**
   * Set the search path to include this stream's schema first
   */
  private async setSearchPath(): Promise<void> {
    await this.pglite.exec(`SET search_path TO ${this.schemaName}, tributary, public`);
  }

  /**
   * Gets the fully qualified table name given a short table name.
   * @param table The short table name
   * @returns The fully qualified table name with schema
   */
  getFullTable(table: string): string {
    // Remove quotes from schema name if already quoted, then re-quote properly
    const cleanSchemaName = this.schemaName.replace(/^"(.*)"$/, '$1');
    return `"${cleanSchemaName}"."${table}"`;
  }

  /**
   * Return a client that has been configured with the right search path for the schema used
   * by this stream.
   */
  local(): TributaryLocal {
    // Remove quotes from schema name if already quoted
    const cleanSchemaName = this.schemaName.replace(/^"(.*)"$/, '$1');
    // Return a TributaryLocal instance with the correct schema
    return new TributaryLocal(this.pglite, cleanSchemaName);
  }

  /**
   * Initialize the stream schema and tables
   */
  async initializeSchema(): Promise<void> {
    try {
      // Create the schema for this stream if it doesn't exist
      // Properly quote the schema name to handle special characters
      await this.pglite.exec(`CREATE SCHEMA IF NOT EXISTS ${this.schemaName}`);
      
      // Set the search path to this schema
      await this.setSearchPath();
    } catch (error: unknown) {
      warn('Could not initialize schema:', error as Error);
    }
  }

  /**
   * Initialize the sync state for this stream
   */
  private async initializeSyncState(): Promise<void> {
    try {
      info('Initializing sync state for stream:', this.getId());
      // Check if we're already tracking this stream
      const checkResult: any = await this.pglite.query(
        `SELECT COUNT(*) as count FROM tributary.streams WHERE id = $1`,
        [this.getId()]
      );
      debug('Check result:', checkResult.rows[0].count);
      
      if (checkResult.rows[0].count === 0) {
        info('Inserting new stream into database');
        // Insert stream info if it doesn't exist
        // We need to provide actual values for the NOT NULL columns
        await this.pglite.query(
          `INSERT INTO tributary.streams (id, schema_id, read_key, write_key, last_sync_index) VALUES ($1, $2, $3, $4, $5)`,
          [this.getId(), this.schemaId, this.publicKey, this.privateKey, null]
        );
        info('Successfully inserted stream');
      } else {
        info('Stream already exists, updating write key if needed');
        // Update write key if we have one now
        await this.pglite.query(
          `UPDATE tributary.streams SET write_key = $1, schema_id = $2 WHERE id = $3`,
          [this.privateKey, this.schemaId, this.getId()]
        );
        info('Successfully updated stream');
      }
      
      // Load the last sync index from the database
      await this.loadLastSyncIndex();
    } catch (e: unknown) {
      error('Could not initialize sync state:', e as Error);
    }
  }

  /**
   * Execute SQL query with persistence guarantee
   * @param query SQL query to execute
   * @param params Query parameters
   * @returns Query result
   */
  async query(query: string, params?: any[]) {
    // Initialize sync state if not already done
    if (!this.syncStateInitialized) {
      await this.initializeSchema();
      await this.initializeSyncState();
      this.syncStateInitialized = true;
    }
    
    // Set the search path to ensure we're operating on the correct schema
    await this.setSearchPath();
    
    // For read operations, we can execute directly on local DB
    if (this.isReadQuery(query)) {
      // @ts-ignore
      return await this.pglite.query(query, params);
    }
    
    // For write operations, we need to ensure server persistence BEFORE local commit
    // Create a transaction log entry
    const transactionEntry: TransactionLogEntry = {
      id: this.generateTransactionId(),
      timestamp: Date.now(),
      query,
      params
    };
    
    // Send to server with persistence guarantee BEFORE executing locally
    await this.ensureServerPersistence(transactionEntry);
    
    // Now execute locally since we have server confirmation
    // @ts-ignore
    const result = await this.pglite.query(query, params);
    
    // Update the transaction entry with the result
    transactionEntry.result = result;
    
    return result;
  }

  /**
   * Execute SQL command with persistence guarantee (for commands that don't return results)
   * @param query SQL command to execute
   * @param params Command parameters
   */
  async exec(query: string, params?: any[]) {
    // Initialize sync state if not already done
    if (!this.syncStateInitialized) {
      await this.initializeSchema();
      await this.initializeSyncState();
      this.syncStateInitialized = true;
    }
    
    // Set the search path to ensure we're operating on the correct schema
    await this.setSearchPath();
    
    // For write operations, we need to ensure server persistence BEFORE local commit
    // Create a transaction log entry
    const transactionEntry: TransactionLogEntry = {
      id: this.generateTransactionId(),
      timestamp: Date.now(),
      query,
      params
    };
    
    // Send to server with persistence guarantee BEFORE executing locally
    await this.ensureServerPersistence(transactionEntry);
    
    // Now execute locally since we have server confirmation
    // Use query instead of exec for parameterized operations to work around PGLite issue
    // @ts-ignore
    if (params && params.length > 0) {
      await this.pglite.query(query, params);
    } else {
      await this.pglite.exec(query);
    }
  }

  /**
   * Execute SQL transaction with persistence guarantee
   * @param callback Transaction callback
   * @returns Transaction result
   */
  async transaction<T>(callback: (tx: any) => Promise<T>) {
    // Initialize sync state if not already done
    if (!this.syncStateInitialized) {
      await this.initializeSchema();
      await this.initializeSyncState();
      this.syncStateInitialized = true;
    }
    
    // Set the search path to ensure we're operating on the correct schema
    await this.setSearchPath();
    
    info('TRANSACTION: Starting transaction method');
    
    // For transactions, we run commands immediately so users can see results and make decisions
    // We record all commands, then post to server while still inside the PGlite transaction
    // If server post fails, we throw an error to cause PGlite to rollback the entire transaction
    
    // Create array to store commands for server persistence
    const recordedCommands: Array<{ query: string, params?: any[] }> = [];
    
    info('TRANSACTION: About to call pglite.transaction');
    
    // Execute the transaction with immediate command execution and recording
    const result = await this.pglite.transaction(async (tx) => {
      info('TRANSACTION: Inside pglite.transaction callback with transaction object');
      
      // Create a transaction object that executes immediately AND records
      const recordingTx = {
        query: async (query: string, params?: any[]) => {
          info('TRANSACTION: recordingTx.query called with:', query);
          try {
            // Execute immediately using the PGlite transaction object (user sees real results)
            // @ts-ignore
            const queryResult = await tx.query(query, params);
            // Record the command for server persistence
            recordedCommands.push({ query, params });
            info('TRANSACTION: recordingTx.query completed');
            return queryResult;
          } catch (error: any) {
            error('TRANSACTION: recordingTx.query failed:', error as Error);
            throw error;
          }
        },
        exec: async (query: string, params?: any[]) => {
          info('TRANSACTION: recordingTx.exec called with:', query);
          try {
            // Execute immediately using the PGlite transaction object (user sees real results)
            // @ts-ignore
            await tx.exec(query, params);
            // Record the command for server persistence
            recordedCommands.push({ query, params });
            info('TRANSACTION: recordingTx.exec completed');
          } catch (error: any) {
            error('TRANSACTION: recordingTx.exec failed:', error as Error);
            throw error;
          }
        }
      };
      
      // Execute the user's callback with our recording transaction
      // User can query data, see results, and make decisions based on those results
      info('TRANSACTION: About to call user callback');
      const callbackResult = await callback(recordingTx);
      info('TRANSACTION: Callback completed successfully with result:', callbackResult);
      
      // IMPORTANT: We're still INSIDE the PGlite transaction here!
      // The transaction has not been committed yet, but all changes are staged
      
      // Now try to persist to server while still inside the transaction
      const transactionEntry: TransactionLogEntry = {
        id: this.generateTransactionId(),
        timestamp: Date.now(),
        query: 'TRANSACTION',
        params: recordedCommands,
        result: callbackResult
      };
      
      try {
        info('TRANSACTION: Attempting server persistence with', recordedCommands.length, 'commands');
        
        // Attempt to persist to server
        await this.ensureServerPersistence(transactionEntry);
        info('TRANSACTION: Server persistence successful');
        
        // If server persistence succeeds, we just return normally
        // PGlite will automatically commit the transaction
        info('TRANSACTION: About to return from transaction callback');
        return callbackResult;
      } catch (serverError) {
        error('TRANSACTION: Server persistence failed:', serverError as Error);
        
        // If server persistence fails, we throw an error
        // This causes PGlite to automatically rollback the entire transaction
        // The local state is reset as if the transaction never happened
        throw new Error(`Transaction failed to persist to server: ${(serverError as Error).message}`);
      }
    });
    
    info('TRANSACTION: pglite.transaction completed successfully with result:', result);
    return result;
  }

  /**
   * Load the last sync index from the database
   */
  private async loadLastSyncIndex(): Promise<void> {
    try {
      const result: any = await this.pglite.query(
        `SELECT last_sync_index FROM tributary.streams WHERE id = $1`,
        [this.getId()]
      );
      
      if (result.rows && result.rows.length > 0 && result.rows[0].last_sync_index !== null) {
        this.lastSyncIndex = result.rows[0].last_sync_index;
      }
    } catch (error: unknown) {
      warn('Could not load last sync index from database:', error as Error);
    }
  }

  /**
   * Save the last sync index to the database
   */
  private async saveLastSyncIndex(): Promise<void> {
    try {
      debug('About to update last sync index:', this.lastSyncIndex, this.getId());
      await this.pglite.query(
        `UPDATE tributary.streams SET last_sync_index = $1 WHERE id = $2`,
        [this.lastSyncIndex, this.getId()]
      );
      debug('Successfully updated last sync index');
    } catch (error: unknown) {
      debug('Error updating last sync index:', error);
      warn('Could not save last sync index to database:', error as Error);
    }
  }

  /**
   * Sync with server - retrieve and apply remote changes
   * @param max Maximum number of blobs to fetch in this sync
   * @returns true if all blobs have been synced, false if there are more blobs to fetch
   */
  async sync(max: number): Promise<boolean> {
    // Initialize sync state if not already done
    if (!this.syncStateInitialized) {
      await this.initializeSchema();
      await this.initializeSyncState();
      this.syncStateInitialized = true;
    }
    
    // Always reload the last sync index from database to ensure consistency
    await this.loadLastSyncIndex();
    
    // Log start sequence number and hash when sync begins
    const initialLastSyncIndex = this.lastSyncIndex;
    info(`SYNC START: Last sync index = ${initialLastSyncIndex}, max blobs = ${max}`);
    
    // Get paginated blob metadata from server
    // Fetch blobs with sequence_number > lastSyncIndex, limited by max
    const result = await this.server.getAllBlobMetadata(
      this.getPublicKeyBase64(),
      this.lastSyncIndex,
      max
    );
    
    info(`SYNC START: Server returned ${result.blobs.length} blobs, total_count = ${result.totalCount}`);
    
    // Track the previous blob's hash for chain verification
    let expectedPriorHash = '';
    if (result.blobs.length > 0 && result.blobs[0].sequenceNumber > 1) {
      // We're not starting from the beginning, so we need to get the hash of the blob
      // that comes before the first one we're syncing
      const prevSequence = result.blobs[0].sequenceNumber - 1;
      if (prevSequence === this.lastSyncIndex) {
        // We just synced this blob, try to get it from server
        const prevBlobMeta = await this.server.getLatestBlobMetadata(this.getPublicKeyBase64());
        if (prevBlobMeta && prevBlobMeta.sequenceNumber >= prevSequence) {
          // Get the specific blob at prevSequence
          const prevBlob = await this.server.retrieveBlob(this.getPublicKeyBase64(), `${this.getPublicKeyBase64()}:${prevSequence}`);
          if (prevBlob) {
            expectedPriorHash = prevBlob.hash;
          }
        }
      }
    }
    
    // Process each blob in sequence order
    for (let i = 0; i < result.blobs.length; i++) {
      const blobMetadata = result.blobs[i];
      try {
        info(`SYNC PROCESSING: Retrieving blob ${blobMetadata.id} with sequence ${blobMetadata.sequenceNumber} and hash ${blobMetadata.hash}`);
        
        // Verify hash chain integrity
        if (i === 0 && expectedPriorHash !== '' && blobMetadata.priorHash !== expectedPriorHash) {
          error(`HASH CHAIN BROKEN: Blob ${blobMetadata.id} has priorHash=${blobMetadata.priorHash} but expected ${expectedPriorHash}`);
          throw new Error(`Hash chain integrity violation at blob ${blobMetadata.id}: expected priorHash=${expectedPriorHash}, got ${blobMetadata.priorHash}`);
        } else if (i > 0) {
          const prevBlob = result.blobs[i - 1];
          if (blobMetadata.priorHash !== prevBlob.hash) {
            error(`HASH CHAIN BROKEN: Blob ${blobMetadata.id} has priorHash=${blobMetadata.priorHash} but previous blob has hash=${prevBlob.hash}`);
            throw new Error(`Hash chain integrity violation at blob ${blobMetadata.id}: expected priorHash=${prevBlob.hash}, got ${blobMetadata.priorHash}`);
          }
        }
        
        // Retrieve the actual blob data
        const blob = await this.server.retrieveBlob(this.getPublicKeyBase64(), blobMetadata.id);
        
        if (blob) {
          try {
            // Decrypt the blob data
            const decryptedData = await this.decryptData(blob.data);
            
            // Deserialize the transaction data
            const transactionData = new TextDecoder().decode(decryptedData);
            const transactionEntry: TransactionLogEntry = JSON.parse(transactionData);
            
            info(`SYNC APPLYING: Processing blob ${blobMetadata.id} with sequence ${blobMetadata.sequenceNumber}`);
            
            // Set the search path before applying operations
            await this.setSearchPath();
            
            // Apply to local database only if it's a write operation
            if (transactionEntry.query === 'TRANSACTION' && Array.isArray(transactionEntry.params)) {
              // Handle transaction - wrap in a try-catch to handle existing table cases
              try {
                await this.pglite.transaction(async (tx) => {
                  for (const command of transactionEntry.params as Array<{ query: string, params?: any[] }>) {
                    if (command.query) {
                      try {
                        // @ts-ignore - PGLite transaction exec has different typing
                        await tx.exec(command.query, command.params);
                      } catch (cmdError) {
                        // Throw errors during sync rather than just warning
                        // Synced SQL expressions should never fail (otherwise they would've failed locally first)
                        throw new Error(`Command failed during sync: ${command.query} - ${(cmdError as Error).message}`);
                      }
                    }
                  }
                });
              } catch (txError) {
                // Log but don't fail on transaction errors
                warn(`Transaction failed during sync`, txError);
              }
            } else {
              // Handle regular query/exec
              if (this.isReadQuery(transactionEntry.query)) {
                // Skip read queries as they don't modify state
                continue;
              } else {
                // Execute all other operations including INSERT
                try {
                  // Use query instead of exec to properly handle parameters
                  await this.pglite.query(transactionEntry.query, transactionEntry.params || []);
                } catch (execError) {
                  // Throw errors during sync rather than just warning
                  // Synced SQL expressions should never fail (otherwise they would've failed locally first)
                  throw new Error(`Exec failed during sync: ${transactionEntry.query} - ${(execError as Error).message}`);
                }
              }
            }
            
            // Update last sync index for ALL processed blobs, not just executed ones
            this.lastSyncIndex = Math.max(this.lastSyncIndex, blob.sequenceNumber);
            
            // Save the last sync index after each blob to track progress
            await this.saveLastSyncIndex();
            
            info(`SYNC PROCESSED: Successfully processed blob ${blobMetadata.id} with sequence ${blobMetadata.sequenceNumber}`);
          } catch (parseError: any) {
            // If we can't parse the blob data, log the error and skip this blob
            // This could happen if the blob contains corrupted data or is not a valid transaction
            error(`Failed to parse blob ${blobMetadata.id}:`, parseError as Error);
            warn(`Skipping blob ${blobMetadata.id} due to parsing error`);
            
            // Still update the last sync index to avoid reprocessing this problematic blob
            this.lastSyncIndex = Math.max(this.lastSyncIndex, blob.sequenceNumber);
            await this.saveLastSyncIndex();
          }
        }
      } catch (err: unknown) {
        error(`Failed to sync blob ${blobMetadata.id}:`, err as Error);
        throw new Error(`Failed to sync blob: ${blobMetadata.id} - ${(err as Error).message}`);
      }
    }
    
    // Log end sequence number when sync ends
    info(`SYNC END: Last sync index changed from ${initialLastSyncIndex} to ${this.lastSyncIndex}`);
    
    // Save the last sync index for future sessions
    await this.saveLastSyncIndex();
    
    
    // Save the last sync index for future sessions
    await this.saveLastSyncIndex();
    
    // Return true if we've synced all blobs on the server
    // Compare our lastSyncIndex with the server's total blob count
    // If lastSyncIndex >= totalCount, we're fully synced
    const isFullySynced = this.lastSyncIndex >= result.totalCount;
    info(`SYNC COMPLETE: isFullySynced = ${isFullySynced} (lastSyncIndex=${this.lastSyncIndex}, total_count=${result.totalCount}, fetched ${result.blobs.length})`);
    return isFullySynced;
  }

  /**
   * Ensure that a transaction is persisted on the server before confirming locally
   * @param transactionEntry The transaction log entry to persist
   */
  private async ensureServerPersistence(transactionEntry: TransactionLogEntry): Promise<void> {
    info('ensureServerPersistence: Starting persistence for transaction', transactionEntry);
    
    // Get the latest blob metadata from the server for proper chaining
    const latestBlobMetadata = await this.server.getLatestBlobMetadata(this.getPublicKeyBase64());
    debug('ensureServerPersistence: Latest blob metadata from server:', latestBlobMetadata);
    
    // Use the latest hash from the server for chaining, or empty string if no blobs exist
    const priorHash = latestBlobMetadata ? latestBlobMetadata.hash : '';
    debug('ensureServerPersistence: Using priorHash:', priorHash);
    
    // Use the next sequence number based on the server's latest blob
    this.sequenceNumber = latestBlobMetadata ? latestBlobMetadata.sequenceNumber + 1 : 1;
    debug('ensureServerPersistence: Using sequenceNumber:', this.sequenceNumber);
    
    // Serialize the transaction data
    const transactionData = JSON.stringify(transactionEntry);
    const dataBytes = new TextEncoder().encode(transactionData);
    debug('ensureServerPersistence: Serialized transaction data length:', dataBytes.length);
    
    // Encrypt the data before storing
    const encryptedData = await this.encryptData(dataBytes);
    debug('ensureServerPersistence: Encrypted data length:', encryptedData.length);
    
    // DEBUG: Print first 16 bytes of encrypted data for comparison
    const previewBytes = encryptedData.slice(0, Math.min(16, encryptedData.length));
    debug('ensureServerPersistence: First 16 bytes of encrypted data:', Array.from(previewBytes));
    
    // Compute body hash (SHA256 of the encrypted data)
    const bodyHash = await computeHash(encryptedData);
    debug('ensureServerPersistence: Computed bodyHash:', bodyHash);
    
    // Compute chain hash using the prior hash and body hash
    const hash = await this.computeChainHash(priorHash, bodyHash);
    debug('ensureServerPersistence: Computed hash:', hash);
    
    // Compute the data that should be signed (just the hash)
    const dataToSignBytes = new TextEncoder().encode(hash);
    debug('ensureServerPersistence: Data to sign length:', dataToSignBytes.length);
    debug('ensureServerPersistence: Data to sign:', hash);
    
    // Sign the data - ensure both parameters are proper Uint8Arrays
    const dataToSign = new Uint8Array(dataToSignBytes);
    const privateKeyArray = new Uint8Array(this.privateKey);
    const signatureBytes = nacl.sign.detached(dataToSign, privateKeyArray);
    const signature = base64url.encode(Buffer.from(signatureBytes));
    debug('ensureServerPersistence: Generated signature length:', signature.length);
    
    try {
      // Log detailed information before attempting to store blob
      debug('ensureServerPersistence: Attempting to store blob with detailed info:', {
        sequenceNumber: this.sequenceNumber,
        priorHash: priorHash,
        bodyHash: bodyHash,
        computedHash: hash,
        dataLength: encryptedData.length
      });
      
      debug('ensureServerPersistence: Attempting to store blob with hash:', hash);
      debug('ensureServerPersistence: Prior hash:', priorHash);
      debug('ensureServerPersistence: Sequence number:', this.sequenceNumber);
      
      // Store the encrypted blob on the server
      const success = await this.server.storeBlob(
        this.getPublicKeyBase64(),
        encryptedData,
        hash,
        priorHash,
        signature,
        this.sequenceNumber
      );
      
      if (!success) {
        throw new Error('Failed to persist transaction on server');
      }
      
      // Log successful stream write with hash and sequence number
      info(`STREAM WRITE SUCCESS: Stored blob with sequence ${this.sequenceNumber} and hash ${hash}`);
      
      info('ensureServerPersistence: Successfully stored blob');
      
      // Update our local latest hash for consistency
      this.latestHash = hash;
      
      // Update the last sync index to indicate this operation has been applied locally
      // This prevents the sync process from re-applying operations that originated locally
      this.lastSyncIndex = Math.max(this.lastSyncIndex, this.sequenceNumber);
      await this.saveLastSyncIndex();
    } catch (err: unknown) {
      error('ensureServerPersistence: Error storing blob:', err as Error);
      // Re-throw with a more specific error message
      throw new Error(`Failed to persist transaction on server: ${(err as Error).message}`);
    }
  }

  /**
   * Derive a symmetric encryption key from the private key
   * @returns Symmetric encryption key
   */
  private async deriveEncryptionKey(): Promise<Uint8Array> {
    // Derive the encryption key by hashing the private key
    // This ensures we don't give away the private write key when sharing read access
    const { computeHashBytes } = await import('./hashUtils.js');
    // Ensure we create a proper Uint8Array from the slice
    const privateKeySlice = new Uint8Array(this.privateKey.slice(0, 32));
    const hashBytes = await computeHashBytes(privateKeySlice); // Hash the actual private scalar
    
    // Return the first 32 bytes as our encryption key
    // Ensure we return a proper Uint8Array by creating a new one from the slice
    const keyBytes = hashBytes.slice(0, nacl.secretbox.keyLength);
    return new Uint8Array(keyBytes);
  }

  /**
   * Encrypt data using symmetric encryption with a random nonce
   * @param data Data to encrypt
   * @returns Encrypted data with nonce prepended
   */
  private async encryptData(data: Uint8Array): Promise<Uint8Array> {
    // Generate a random nonce
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    
    // Derive the encryption key
    const secretKey = await this.deriveEncryptionKey();
    
    // Ensure all parameters are proper Uint8Arrays
    const dataArray = new Uint8Array(data);
    const nonceArray = new Uint8Array(nonce);
    const keyArray = new Uint8Array(secretKey);
    
    // Encrypt the data
    const encryptedData = nacl.secretbox(dataArray, nonceArray, keyArray);
    
    // Prepend the nonce to the encrypted data
    const result = new Uint8Array(nonce.length + encryptedData.length);
    result.set(nonce);
    result.set(encryptedData, nonce.length);
    
    return result;
  }

  /**
   * Decrypt data using symmetric encryption
   * @param data Data to decrypt (with nonce prepended)
   * @returns Decrypted data
   */
  private async decryptData(data: Uint8Array): Promise<Uint8Array> {
    // Extract the nonce (first 24 bytes)
    const nonce = data.slice(0, nacl.secretbox.nonceLength);
    
    // Extract the encrypted data
    const encryptedData = data.slice(nacl.secretbox.nonceLength);
    
    // Derive the encryption key
    const secretKey = await this.deriveEncryptionKey();
    
    // Ensure all parameters are proper Uint8Arrays
    const encryptedArray = new Uint8Array(encryptedData);
    const nonceArray = new Uint8Array(nonce);
    const keyArray = new Uint8Array(secretKey);
    
    // Decrypt the data
    const decryptedData = nacl.secretbox.open(encryptedArray, nonceArray, keyArray);
    
    if (decryptedData === null) {
      throw new Error('Failed to decrypt data');
    }
    
    return decryptedData;
  }

  /**
   * Compute chain hash from prior chain hash and body hash
   * This ensures that hashes don't grow indefinitely by using SHA256(priorHash + bodyHash)
   * @param priorHash The previous chain hash (or empty string for first entry)
   * @param bodyHash The hash of the body data
   * @returns The computed chain hash
   */
  private async computeChainHash(priorHash: string, bodyHash: string): Promise<string> {
    // Concatenate prior_hash + body_hash, then compute SHA256 of the result
    const concatenated = `${priorHash}${bodyHash}`;
    return await computeHash(new TextEncoder().encode(concatenated));
  }

  private isReadQuery(query: string): boolean {
    const trimmedQuery = query.trim().toLowerCase();
    return trimmedQuery.startsWith('select') || 
           trimmedQuery.startsWith('explain') || 
           trimmedQuery.startsWith('show');
  }

  private getPublicKeyBase64(): string {
    return base64url.encode(Buffer.from(this.publicKey));
  }

  private generateTransactionId(): string {
    return `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }
}
