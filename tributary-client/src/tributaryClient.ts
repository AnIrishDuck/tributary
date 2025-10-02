// Main TributaryClient class that wraps PGLite with persistence guarantees
import { PGlite } from '@electric-sql/pglite';

// Import tweetnacl-util functions
const util = require('tweetnacl-util');
const { encodeBase64, decodeBase64 } = util;

// Import tweetnacl functions
import nacl from 'tweetnacl';

import { Server } from './server';

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

  constructor(options: {
    server: Server;
    privateKey: string | Uint8Array;
    collectionId: string;
    db?: PGlite; // Optional existing PGlite instance
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
  }

  /**
   * Execute SQL query with persistence guarantee
   * @param query SQL query to execute
   * @param params Query parameters
   * @returns Query result
   */
  async query(query: string, params?: any[]) {
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
   * Sync with server - retrieve and apply remote changes
   */
  async sync() {
    console.log(`Syncing collection ${this.collectionId}`);
    // In a full implementation, this would fetch all transactions from the server
    // and apply them to the local database to ensure consistency
  }

  /**
   * Ensure that a transaction is persisted on the server before confirming locally
   * @param transactionEntry The transaction log entry to persist
   */
  private async ensureServerPersistence(transactionEntry: TransactionLogEntry): Promise<void> {
    // Get the latest blob metadata from the server for proper chaining
    const latestBlobMetadata = await this.server.getLatestBlobMetadata(this.getPublicKeyBase64());
    
    // Use the latest hash from the server for chaining, or empty string if no blobs exist
    const priorHash = latestBlobMetadata ? latestBlobMetadata.hash : '';
    
    // Use the next sequence number based on the server's latest blob
    this.sequenceNumber = latestBlobMetadata ? latestBlobMetadata.sequenceNumber + 1 : 1;
    
    // Serialize the transaction data
    const transactionData = JSON.stringify(transactionEntry);
    const dataBytes = new TextEncoder().encode(transactionData);
    
    // Compute body hash (SHA256 of the data)
    const bodyHash = await this.computeHash(dataBytes);
    
    // Compute Merkle tree hash
    const treeHash = await this.computeMerkleHash(priorHash, bodyHash);
    
    // Create the data to be signed (includes the tree hash and encoded data)
    const dataToSign = `${treeHash}:${encodeBase64(dataBytes)}`;
    const dataToSignBytes = new TextEncoder().encode(dataToSign);
    
    // Sign the data
    const signatureBytes = nacl.sign.detached(dataToSignBytes, this.privateKey);
    const signature = encodeBase64(signatureBytes);
    
    try {
      // Store the blob on the server
      const success = await this.server.storeBlob(
        this.getPublicKeyBase64(),
        dataBytes,
        treeHash,
        priorHash,
        signature,
        this.sequenceNumber
      );
      
      if (!success) {
        throw new Error('Failed to persist transaction on server');
      }
      
      // Update our local latest hash for consistency
      this.latestHash = treeHash;
    } catch (error) {
      // Re-throw with a more specific error message
      throw new Error(`Failed to persist transaction on server: ${(error as Error).message}`);
    }
  }

  /**
   * Compute SHA256 hash of data
   * @param data Data to hash
   * @returns Hex-encoded hash
   */
  private async computeHash(data: Uint8Array): Promise<string> {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      // Browser or Node.js with crypto support
      const hashBuffer = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      // Fallback for environments without crypto support
      // In a real implementation, we would use a proper SHA256 library
      return 'hash-placeholder';
    }
  }

  /**
   * Compute Merkle tree hash from prior hash and body hash
   * @param priorHash Previous hash in the chain
   * @param bodyHash Hash of the current data
   * @returns Hex-encoded Merkle hash
   */
  private async computeMerkleHash(priorHash: string, bodyHash: string): Promise<string> {
    const data = new TextEncoder().encode(priorHash + bodyHash);
    return await this.computeHash(data);
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
