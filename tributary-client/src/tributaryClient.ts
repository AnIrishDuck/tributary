// Main TributaryClient class that wraps PGLite with persistence guarantees
import { PGlite } from '@electric-sql/pglite';

// Import tweetnacl-util functions
const util = require('tweetnacl-util');
const { encodeBase64, decodeBase64 } = util;

// Import tweetnacl functions
import nacl from 'tweetnacl';

import { Server } from './server';
import { logger, warn, error, info, debug } from './logger';

// Type definitions for our transaction log
interface TransactionLogEntry {
  id: string;
  timestamp: number;
  query: string;
  params?: any[];
  result?: any;
}

export class TributaryClient {
  private pglite: PGlite;
  private server: Server;
  private privateKey: Uint8Array;
  private publicKey: Uint8Array;
  private sequenceNumber: number = 0;
  private collectionId: string;
  private latestHash: string = ''; // Track the latest hash for chaining
  private lastSyncIndex: number = 0;
  private syncTableName: string;
  private syncStateInitialized: boolean = false;

  constructor(options: {
    server: Server;
    privateKey: string | Uint8Array;
    collectionId: string;
    db?: PGlite; // Optional existing PGlite instance
    syncTableName?: string; // Optional custom table name for sync state
  }) {
    this.server = options.server;
    this.collectionId = options.collectionId;
    
    // Handle private key
    if (typeof options.privateKey === 'string') {
      this.privateKey = decodeBase64(options.privateKey);
    } else {
      this.privateKey = options.privateKey;
    }
    
    // Derive public key from private key
    // In Ed25519, the public key is the last 32 bytes of the expanded private key
    this.publicKey = this.privateKey.slice(32);
    
    // Use provided DB or create a new one
    this.pglite = options.db || new PGlite();
    
    // Set sync table name (default or custom)
    this.syncTableName = options.syncTableName || '__tributary_sync_state';
    
    // Initialize sync state table synchronously in constructor
    // The actual async initialization will be done on first use
  }

  /**
   * Initialize the sync state table in the database
   */
  private async initializeSyncState(): Promise<void> {
    try {
      // Create the sync state table if it doesn't exist
      await this.pglite.exec(
        `CREATE TABLE IF NOT EXISTS ${this.syncTableName} (
          id INTEGER PRIMARY KEY DEFAULT 1,
          last_sync_index INTEGER NOT NULL DEFAULT 0
        )`
      );
      
      // Check if row already exists
      const checkResult: any = await this.pglite.query(
        `SELECT COUNT(*) as count FROM ${this.syncTableName} WHERE id = 1`
      );
      
      if (checkResult.rows[0].count === 0) {
        // Insert default row if it doesn't exist
        await this.pglite.exec(
          `INSERT INTO ${this.syncTableName} (id, last_sync_index) VALUES (1, 0)`
        );
      }
      
      // Load the last sync index from the database
      await this.loadLastSyncIndex();
    } catch (error: unknown) {
      warn('Could not initialize sync state table:', error as Error);
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
      await this.initializeSyncState();
      this.syncStateInitialized = true;
    }
    
    // For read operations, we can execute directly on local DB
    if (this.isReadQuery(query)) {
      return await this.pglite.query(query, params as any);
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
    const result = await this.pglite.query(query, params as any);
    
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
      await this.initializeSyncState();
      this.syncStateInitialized = true;
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
    await this.pglite.exec(query, params as any);
  }

  /**
   * Execute SQL transaction with persistence guarantee
   * @param callback Transaction callback
   * @returns Transaction result
   */
  async transaction<T>(callback: (tx: any) => Promise<T>) {
    // Initialize sync state if not already done
    if (!this.syncStateInitialized) {
      await this.initializeSyncState();
      this.syncStateInitialized = true;
    }
    
    // For transactions, we run commands immediately so users can see results and make decisions
    // We record all commands, then post to server while still inside the PGlite transaction
    // If server post fails, we throw an error to cause PGlite to rollback the entire transaction
    
    // Create array to store commands for server persistence
    const recordedCommands: Array<{ query: string, params?: any[] }> = [];
    
    // Execute the transaction with immediate command execution and recording
    return await this.pglite.transaction(async (pgliteTx: any) => {
      // Create a transaction object that executes immediately AND records
      const recordingTx = {
        query: async (query: string, params?: any[]) => {
          // Execute immediately using real PGlite transaction (user sees real results)
          const queryResult = await pgliteTx.query(query, params);
          // Record the command for server persistence
          recordedCommands.push({ query, params });
          return queryResult;
        },
        exec: async (query: string, params?: any[]) => {
          // Execute immediately using real PGlite transaction (user sees real results)
          await pgliteTx.exec(query, params);
          // Record the command for server persistence
          recordedCommands.push({ query, params });
        }
      };
      
      // Execute the user's callback with our recording transaction
      // User can query data, see results, and make decisions based on those results
      const result = await callback(recordingTx);
      
      // IMPORTANT: We're still INSIDE the PGlite transaction here!
      // The transaction has not been committed yet, but all changes are staged
      
      // Now try to persist to server while still inside the transaction
      const transactionEntry: TransactionLogEntry = {
        id: this.generateTransactionId(),
        timestamp: Date.now(),
        query: 'TRANSACTION',
        params: recordedCommands
      };
      
      try {
        // Attempt to persist to server
        await this.ensureServerPersistence(transactionEntry);
        
        // If server persistence succeeds, we just return normally
        // PGlite will automatically commit the transaction
        transactionEntry.result = result;
        return result;
      } catch (serverError) {
        // If server persistence fails, we throw an error
        // This causes PGlite to automatically rollback the entire transaction
        // The local state is reset as if the transaction never happened
        throw new Error(`Transaction failed to persist to server: ${(serverError as Error).message}`);
      }
    });
  }

  /**
   * Load the last sync index from the database
   */
  private async loadLastSyncIndex(): Promise<void> {
    try {
      const result: any = await this.pglite.query(
        `SELECT last_sync_index FROM ${this.syncTableName} WHERE id = 1`
      );
      
      if (result.rows && result.rows.length > 0) {
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
      // Use string interpolation for now to avoid parameter binding issues
      await this.pglite.exec(
        `UPDATE ${this.syncTableName} 
         SET last_sync_index = ${this.lastSyncIndex}
         WHERE id = 1`
      );
    } catch (error: unknown) {
      warn('Could not save last sync index to database:', error as Error);
    }
  }

    /**
   * Sync with server - retrieve and apply remote changes
   */
  async sync() {
    // Initialize sync state if not already done
    if (!this.syncStateInitialized) {
      await this.initializeSyncState();
      this.syncStateInitialized = true;
    }
    
    // Always reload the last sync index from database to ensure consistency
    await this.loadLastSyncIndex();
    
    // Log start sequence number and hash when sync begins
    const initialLastSyncIndex = this.lastSyncIndex;
    info(`SYNC START: Last sync index = ${initialLastSyncIndex}`);
    
    // Get all blob metadata from server, ordered by sequence number
    const blobMetadataList = await this.server.getAllBlobMetadata(this.getPublicKeyBase64());
    
    // Filter out blobs that have already been synced
    const newBlobs = blobMetadataList.filter(blob => blob.sequenceNumber > this.lastSyncIndex);
    
    info(`SYNC START: Found ${newBlobs.length} new blobs to process (from sequence ${this.lastSyncIndex + 1} onwards)`);
    
    // Process each new blob in sequence order
    for (const blobMetadata of newBlobs) {
      try {
        info(`SYNC PROCESSING: Retrieving blob ${blobMetadata.id} with sequence ${blobMetadata.sequenceNumber} and hash ${blobMetadata.hash}`);
        
        // Retrieve the actual blob data
        const blob = await this.server.retrieveBlob(this.getPublicKeyBase64(), blobMetadata.id);
        
        if (blob) {
          // Decrypt the blob data
          const decryptedData = this.decryptData(blob.data);
          
          // Deserialize the transaction data
          const transactionData = new TextDecoder().decode(decryptedData);
          const transactionEntry: TransactionLogEntry = JSON.parse(transactionData);
          
          info(`SYNC APPLYING: Processing blob ${blobMetadata.id} with sequence ${blobMetadata.sequenceNumber}`);
          
          // Apply to local database only if it's a write operation
          if (transactionEntry.query === 'TRANSACTION' && Array.isArray(transactionEntry.params)) {
            // Handle transaction - wrap in a try-catch to handle existing table cases
            try {
              await this.pglite.transaction(async (tx) => {
                for (const command of transactionEntry.params as Array<{ query: string, params?: any[] }>) {
                  if (command.query) {
                    // Skip DDL operations (CREATE, ALTER, DROP) as they likely already exist
                    const upperQuery = command.query.trim().toUpperCase();
                    if (upperQuery.startsWith('CREATE') || 
                        upperQuery.startsWith('ALTER') || 
                        upperQuery.startsWith('DROP')) {
                      continue;
                    }
                    
                    try {
                      await tx.exec(command.query);
                    } catch (cmdError) {
                      // Log but don't fail on individual command errors
                      warn(`Command failed during sync: ${command.query}`, cmdError);
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
              // Skip DDL operations during sync
              const upperQuery = transactionEntry.query.trim().toUpperCase();
              if (upperQuery.startsWith('CREATE') || 
                  upperQuery.startsWith('ALTER') || 
                  upperQuery.startsWith('DROP')) {
                // Still update sync index even though we skip execution
              }
              // Execute all other operations including INSERT
              else {
                try {
                  await this.pglite.exec(transactionEntry.query);
                } catch (execError) {
                  // Log but don't fail on exec errors
                  warn(`Exec failed during sync: ${transactionEntry.query}`, execError);
                }
              }
            }
          }
          
          // Update last sync index for ALL processed blobs, not just executed ones
          this.lastSyncIndex = Math.max(this.lastSyncIndex, blob.sequenceNumber);
          
          // Save the last sync index after each blob to track progress
          await this.saveLastSyncIndex();
          
          info(`SYNC PROCESSED: Successfully processed blob ${blobMetadata.id} with sequence ${blobMetadata.sequenceNumber}`);
        }
      } catch (err: unknown) {
        error(`Failed to sync blob ${blobMetadata.id}:`, err as Error);
        // Continue with other blobs even if one fails
      }
    }
    
    // Log end sequence number when sync ends
    info(`SYNC END: Last sync index changed from ${initialLastSyncIndex} to ${this.lastSyncIndex}`);
    
    // Save the last sync index for future sessions
    await this.saveLastSyncIndex();
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
    
    // DEBUG: Print the exact bytes in the body
    debug('ensureServerPersistence: Raw transaction data bytes:', Array.from(dataBytes));
    debug('ensureServerPersistence: Raw transaction data as string:', transactionData);
    
    // Encrypt the data before storing
    const encryptedData = this.encryptData(dataBytes);
    debug('ensureServerPersistence: Encrypted data length:', encryptedData.length);
    
    // DEBUG: Print first 16 bytes of encrypted data for comparison
    const previewBytes = encryptedData.slice(0, Math.min(16, encryptedData.length));
    debug('ensureServerPersistence: First 16 bytes of encrypted data:', Array.from(previewBytes));
    
    // Compute body hash (SHA256 of the encrypted data)
    const bodyHash = await this.computeHash(encryptedData);
    debug('ensureServerPersistence: Computed bodyHash:', bodyHash);
    
    // Compute chain hash using the prior hash and body hash
    const hash = await this.computeChainHash(priorHash, bodyHash);
    debug('ensureServerPersistence: Computed hash:', hash);
    
    // Create the data to be signed (just the hash)
    const dataToSignBytes = new TextEncoder().encode(hash);
    debug('ensureServerPersistence: Data to sign length:', dataToSignBytes.length);
    debug('ensureServerPersistence: Data to sign:', hash);
    
    // Sign the data
    const signatureBytes = nacl.sign.detached(dataToSignBytes, this.privateKey);
    const signature = encodeBase64(signatureBytes);
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
    } catch (err: unknown) {
      error('ensureServerPersistence: Error storing blob:', err as Error);
      // Re-throw with a more specific error message
      throw new Error(`Failed to persist transaction on server: ${(err as Error).message}`);
    }
  }

  /**
   * Derive a symmetric encryption key from the public key
   * @returns Symmetric encryption key
   */
  private deriveEncryptionKey(): Uint8Array {
    // Use the public key as the secret key for symmetric encryption
    // In a real implementation, you might want to derive a separate key
    const secretKey = this.publicKey.slice(0, nacl.secretbox.keyLength);
    
    // Pad the secret key to the required length if necessary
    let fullSecretKey = secretKey;
    if (secretKey.length < nacl.secretbox.keyLength) {
      fullSecretKey = new Uint8Array(nacl.secretbox.keyLength);
      fullSecretKey.set(secretKey);
    }
    
    return fullSecretKey;
  }

  /**
   * Encrypt data using symmetric encryption with a random nonce
   * @param data Data to encrypt
   * @returns Encrypted data with nonce prepended
   */
  private encryptData(data: Uint8Array): Uint8Array {
    // Generate a random nonce
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    
    // Derive the encryption key
    const secretKey = this.deriveEncryptionKey();
    
    // Encrypt the data
    const encryptedData = nacl.secretbox(data, nonce, secretKey);
    
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
  private decryptData(data: Uint8Array): Uint8Array {
    // Extract the nonce (first 24 bytes)
    const nonce = data.slice(0, nacl.secretbox.nonceLength);
    
    // Extract the encrypted data
    const encryptedData = data.slice(nacl.secretbox.nonceLength);
    
    // Derive the encryption key
    const secretKey = this.deriveEncryptionKey();
    
    // Decrypt the data
    const decryptedData = nacl.secretbox.open(encryptedData, nonce, secretKey);
    
    if (decryptedData === null) {
      throw new Error('Failed to decrypt data');
    }
    
    return decryptedData;
  }

  /**
   * Compute SHA256 hash of data
   * @param data Data to hash
   * @returns Hex-encoded hash
   */
  private async computeHash(data: Uint8Array): Promise<string> {
    // Try to use Node.js crypto if available
    try {
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256');
      hash.update(Buffer.from(data));
      const result = hash.digest('hex');
      debug(`computeHash: Successfully computed hash for ${data.length} bytes using Node.js crypto`);
      return result;
    } catch (nodeCryptoError) {
      // Fallback to Web Crypto API
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        try {
          // Browser or Node.js with crypto support
          const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const result = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          debug(`computeHash: Successfully computed real hash for ${data.length} bytes using Web Crypto`);
          return result;
        } catch (err: unknown) {
          error(`computeHash: Web Crypto API failed:`, err as Error);
          throw new Error(`Failed to compute hash with both Node.js and Web Crypto: ${err}`);
        }
      } else {
        error(`computeHash: Neither Node.js nor Web Crypto API available. typeof crypto: ${typeof crypto}`);
        throw new Error('Neither Node.js nor Web Crypto API available - cannot compute hash. This is a critical error that breaks signature verification.');
      }
    }
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
    return await this.computeHash(new TextEncoder().encode(concatenated));
  }

  private isReadQuery(query: string): boolean {
    const trimmedQuery = query.trim().toLowerCase();
    return trimmedQuery.startsWith('select') || 
           trimmedQuery.startsWith('explain') || 
           trimmedQuery.startsWith('show');
  }

  private getPublicKeyBase64(): string {
    return encodeBase64(this.publicKey);
  }

  private generateTransactionId(): string {
    return `txn-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  }
}
