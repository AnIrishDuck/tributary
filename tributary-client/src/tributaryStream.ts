// TributaryStream class for managing individual streams
import { PGliteInterface } from '@electric-sql/pglite';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';
import { Server } from './server.js';
import { TributaryLocal } from './tributaryLocal.js';
import { TributaryBlob } from './tributaryBlob.js';
import { logger, warn, error, info, debug } from './logger.js';
import { computeHash } from './hashUtils.js';
import { estimateStreamStorageBytes, StreamStorageEstimate } from './storage.js';

// Type definitions for our transaction log
interface TransactionLogEntry {
  id: string;
  timestamp: number;
  query: string;
  params?: any[];
  result?: any;
}

/**
 * Thrown when a write operation is attempted but the stream has unsynced
 * remote transactions. The caller should sync fully before retrying.
 */
export class SyncRequiredError extends Error {
  constructor(currentIndex: number, finalIndex: number) {
    super(
      `Stream has unsynced remote transactions (synced ${currentIndex}/${finalIndex}). ` +
      `Sync fully before writing to avoid data inconsistency.`
    );
    this.name = 'SyncRequiredError';
  }
}

/**
 * Sync status information for a stream
 */
export interface SyncStatus {
  /** Current sync index (last blob synced) */
  currentIndex: number;
  /** Final index (total blobs on server) */
  finalIndex: number;
  /** Check if sync is complete */
  complete(): boolean;
  /** Error encountered during sync, if any */
  error?: Error;
}

/**
 * A recorded sync error
 */
export interface SyncError {
  id: string;
  stream_id: string;
  blob_sequence: number | null;
  error_type: string;
  error_message: string;
  occurred_at: string;
  query: string | null;
  params: string | null;
}

export class TributaryStream {
  private pglite: PGliteInterface;
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
  private searchPathSQL: string;
  private prefetchCache: {
    promise: Promise<{
      blobs: Array<{ sequenceNumber: number; hash: string; data: Uint8Array }>;
      totalCount: number;
    }>;
    startSequence: number;
    max: number;
  } | null = null;

  constructor(options: {
    server: Server;
    privateKey: Uint8Array;
    pglite: PGliteInterface;
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
    // Pre-compute the SET LOCAL statement. SET LOCAL scopes the search_path
    // to the current transaction, preventing concurrent operations on other
    // streams from stomping on it.
    this.searchPathSQL = `SET LOCAL search_path TO ${this.schemaName}, tributary, public`;
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
   * Estimate the storage used by this stream's schema.
   */
  async estimateStorage(): Promise<StreamStorageEstimate> {
    const cleanSchemaName = this.schemaName.replace(/^"(.*)"$/, '$1');
    return estimateStreamStorageBytes(this.pglite, cleanSchemaName);
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
   * Create a TributaryBlob instance for uploading/downloading encrypted blobs
   * associated with this stream.
   */
  blob(): TributaryBlob {
    return new TributaryBlob(this.server, this.privateKey);
  }

  /**
   * Initialize the stream schema and tables
   */
  async initializeSchema(): Promise<void> {
    try {
      // Create the schema for this stream if it doesn't exist
      // Properly quote the schema name to handle special characters
      await this.pglite.exec(`CREATE SCHEMA IF NOT EXISTS ${this.schemaName}`);
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
      
      if (Number(checkResult.rows[0].count) === 0) {
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

    // For read operations, wrap in a transaction with SET LOCAL search_path
    // so the search_path is scoped and cannot be changed by concurrent streams.
    if (this.isReadQuery(query)) {
      return await this.pglite.transaction(async (tx) => {
        await tx.exec(this.searchPathSQL);
        // @ts-ignore
        return await tx.query(query, params);
      });
    }

    // Record the local sync index BEFORE anything (including sync guard).
    // This becomes the basis for the server POST — the server rejects gaps.
    const guardIndex = this.lastSyncIndex;

    // Everything happens inside a single PGlite transaction so that a local
    // DB failure (e.g. constraint violation) prevents the server write, and
    // a server failure rolls back the local change.
    const result = await this.pglite.transaction(async (tx) => {
      await tx.exec(this.searchPathSQL);

      // 1. Execute locally FIRST to catch postgres errors before touching the server
      // @ts-ignore
      const queryResult = await tx.query(query, params);

      // 2. Sync guard: verify no unsynced remote blobs exist (server-only check)
      await this.checkSyncGuard(guardIndex);

      // 3. Persist to server
      const transactionEntry: TransactionLogEntry = {
        id: this.generateTransactionId(),
        timestamp: Date.now(),
        query,
        params
      };
      await this.ensureServerPersistence(transactionEntry, { skipDbSyncSave: true, guardIndex });

      return queryResult;
    });

    // Transaction committed successfully — persist sync index outside the transaction
    await this.saveLastSyncIndex();

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

    // Record the local sync index BEFORE anything (including sync guard).
    const guardIndex = this.lastSyncIndex;

    // Single PGlite transaction: local exec → sync guard → server persist.
    // If the local exec fails (e.g. constraint violation), we never touch the server.
    // If the server persist fails, PGlite rolls back the local change.
    await this.pglite.transaction(async (tx) => {
      await tx.exec(this.searchPathSQL);

      // 1. Execute locally FIRST to catch postgres errors
      // Use query instead of exec for parameterized operations to work around PGLite issue
      // @ts-ignore
      if (params && params.length > 0) {
        await tx.query(query, params);
      } else {
        await tx.exec(query);
      }

      // 2. Sync guard: verify no unsynced remote blobs exist (server-only check)
      await this.checkSyncGuard(guardIndex);

      // 3. Persist to server
      const transactionEntry: TransactionLogEntry = {
        id: this.generateTransactionId(),
        timestamp: Date.now(),
        query,
        params
      };
      await this.ensureServerPersistence(transactionEntry, { skipDbSyncSave: true, guardIndex });
    });

    // Transaction committed successfully — persist sync index outside the transaction
    await this.saveLastSyncIndex();
  }

  /**
   * Lightweight sync guard: verifies no unsynced remote blobs exist.
   * Unlike sync(), this does NOT apply any blobs — it only queries the server.
   * Safe to call inside an open PGlite transaction (no DB operations).
   * Throws SyncRequiredError if ANY remote transactions exist beyond guardIndex.
   */
  private async checkSyncGuard(guardIndex: number): Promise<void> {
    const probe = await this.server.getBlobsArrow(this.getPublicKeyBase64(), guardIndex, 1);
    if (probe.totalCount > guardIndex) {
      throw new SyncRequiredError(guardIndex, probe.totalCount);
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

    info('TRANSACTION: Starting transaction method');

    // Record the local sync index BEFORE anything (including sync guard).
    const guardIndex = this.lastSyncIndex;

    // For transactions, we run commands immediately so users can see results and make decisions.
    // We record all commands, then check sync guard + persist to server while still inside
    // the PGlite transaction. If any step fails, PGlite rolls back everything.

    // Create array to store commands for server persistence
    const recordedCommands: Array<{ query: string, params?: any[] }> = [];

    info('TRANSACTION: About to call pglite.transaction');

    // Execute the transaction with immediate command execution and recording
    const result = await this.pglite.transaction(async (tx) => {
      // Set search_path locally within this transaction so concurrent
      // operations on other streams cannot interfere.
      await tx.exec(this.searchPathSQL);
      info('TRANSACTION: Inside pglite.transaction callback with transaction object');

      // Create a transaction object that executes immediately AND records
      const recordingTx = {
        query: async (query: string, params?: any[]) => {
          info('TRANSACTION: recordingTx.query called with:', query);
          // Execute immediately using the PGlite transaction object (user sees real results)
          // @ts-ignore
          const queryResult = await tx.query(query, params);
          // Record the command for server persistence
          recordedCommands.push({ query, params });
          info('TRANSACTION: recordingTx.query completed');
          return queryResult;
        },
        exec: async (query: string, params?: any[]) => {
          info('TRANSACTION: recordingTx.exec called with:', query);
          // Execute immediately using the PGlite transaction object (user sees real results)
          // @ts-ignore
          await tx.exec(query, params);
          // Record the command for server persistence
          recordedCommands.push({ query, params });
          info('TRANSACTION: recordingTx.exec completed');
        }
      };

      // Execute the user's callback with our recording transaction.
      // Local postgres errors (constraint violations, etc.) are caught here
      // and cause an immediate rollback — the server is never touched.
      info('TRANSACTION: About to call user callback');
      const callbackResult = await callback(recordingTx);
      info('TRANSACTION: Callback completed successfully with result:', callbackResult);

      // IMPORTANT: We're still INSIDE the PGlite transaction here!
      // The transaction has not been committed yet, but all changes are staged.

      // Sync guard: verify no unsynced remote blobs exist (server-only check)
      await this.checkSyncGuard(guardIndex);

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
        await this.ensureServerPersistence(transactionEntry, { skipDbSyncSave: true, guardIndex });
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

    // Transaction committed successfully — persist sync index outside the transaction
    await this.saveLastSyncIndex();

    return result;
  }

  /**
   * Record a sync error to the tributary.sync_errors table
   */
  private async recordSyncError(
    errorType: string,
    errorMessage: string,
    blobSequence?: number,
    query?: string,
    params?: any[]
  ): Promise<void> {
    try {
      const id = `err-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      await this.pglite.query(
        `INSERT INTO tributary.sync_errors (id, stream_id, blob_sequence, error_type, error_message, occurred_at, query, params)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          this.getId(),
          blobSequence ?? null,
          errorType,
          errorMessage,
          new Date().toISOString(),
          query ?? null,
          params != null ? JSON.stringify(params) : null,
        ]
      );
    } catch (e: unknown) {
      warn('Failed to record sync error:', e as Error);
    }
  }

  /**
   * Get all sync errors for this stream, ordered by most recent first
   */
  async getErrors(): Promise<SyncError[]> {
    const result: any = await this.pglite.query(
      `SELECT id, stream_id, blob_sequence, error_type, error_message, occurred_at, query, params
       FROM tributary.sync_errors
       WHERE stream_id = $1
       ORDER BY occurred_at DESC`,
      [this.getId()]
    );
    return result.rows;
  }

  /**
   * Clear all sync errors for this stream
   */
  async clearErrors(): Promise<void> {
    await this.pglite.query(
      `DELETE FROM tributary.sync_errors WHERE stream_id = $1`,
      [this.getId()]
    );
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
   * @returns SyncStatus containing current and final index
   */
  async sync(max: number): Promise<SyncStatus> {
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
    
    // Check if we have a valid prefetch that matches the request sync would make
    let result;
    if (
      this.prefetchCache &&
      this.prefetchCache.startSequence === this.lastSyncIndex &&
      this.prefetchCache.max === max
    ) {
      info('SYNC: Using prefetched result');
      result = await this.prefetchCache.promise;
      this.prefetchCache = null;
    } else {
      // Invalidate any stale prefetch
      this.prefetchCache = null;
      // Use the new Arrow endpoint to fetch blobs with data in a single request
      // This is more efficient than the old approach of fetching metadata then individual blobs
      result = await this.server.getBlobsArrow(
        this.getPublicKeyBase64(),
        this.lastSyncIndex,
        max
      );
    }
    
    info(`SYNC START: Server returned ${result.blobs.length} blobs via Arrow, total_count = ${result.totalCount}`);
    
    // Track the previous blob's hash for chain verification
    // Since we only have hash (not prior_hash) in Arrow response, we need to verify chain differently
    let expectedHash = '';
    if (result.blobs.length > 0 && result.blobs[0].sequenceNumber > 1) {
      // We're not starting from the beginning, so we need to get the hash of the blob
      // that comes before the first one we're syncing to verify the chain
      const prevSequence = result.blobs[0].sequenceNumber - 1;
      if (prevSequence === this.lastSyncIndex) {
        // We just synced this blob, try to get it from server
        const prevBlobMeta = await this.server.getLatestBlobMetadata(this.getPublicKeyBase64());
        if (prevBlobMeta && prevBlobMeta.sequenceNumber >= prevSequence) {
          // The expected hash for the first blob should chain from this previous blob
          expectedHash = prevBlobMeta.hash;
        }
      }
    }
    
    // Process each blob in sequence order
    // Phase 1: Decrypt and deserialize all blobs (CPU-only, no DB round-trips).
    // This separates the crypto work from the DB work so we can batch all SQL
    // into a single transaction in phase 2.
    interface DeserializedBlob {
      entry: TransactionLogEntry;
      sequenceNumber: number;
    }
    const writeBlobs: DeserializedBlob[] = [];
    // Use the captured initialLastSyncIndex, NOT this.lastSyncIndex which can
    // be modified by concurrent ensureServerPersistence calls during the await
    // points in this method. Reading the live value caused finalSyncIndex to
    // jump past unsynced remote blobs when a write happened mid-sync.
    let finalSyncIndex = initialLastSyncIndex;

    const cryptoStart = performance.now();
    for (let i = 0; i < result.blobs.length; i++) {
      const blob = result.blobs[i];
      info(`SYNC PROCESSING: Processing blob with sequence ${blob.sequenceNumber} and hash ${blob.hash}`);

      // Chain verification logging
      if (i === 0 && expectedHash !== '') {
        info(`SYNC: First blob should chain from hash ${expectedHash}`);
      } else if (i > 0) {
        const prevBlob = result.blobs[i - 1];
        expectedHash = prevBlob.hash;
        info(`SYNC: Blob ${blob.sequenceNumber} should chain from hash ${expectedHash}`);
      }

      if (!blob.data) continue;

      try {
        const decryptedData = await this.decryptData(blob.data);
        const transactionData = new TextDecoder().decode(decryptedData);
        const transactionEntry: TransactionLogEntry = JSON.parse(transactionData);

        finalSyncIndex = Math.max(finalSyncIndex, blob.sequenceNumber);

        if (!this.isReadQuery(transactionEntry.query)) {
          writeBlobs.push({ entry: transactionEntry, sequenceNumber: blob.sequenceNumber });
        }
      } catch (parseError: any) {
        error(`Failed to parse blob with sequence ${blob.sequenceNumber}:`, parseError as Error);
        warn(`Skipping blob with sequence ${blob.sequenceNumber} due to parsing error`);
        // Advance past unparseable blobs so we don't re-fetch them
        finalSyncIndex = Math.max(finalSyncIndex, blob.sequenceNumber);
        // Record the error for app visibility
        await this.recordSyncError(
          'parse_error',
          (parseError as Error).message || String(parseError),
          blob.sequenceNumber
        );
      }
    }

    // Phase 2: Apply all write blobs in a single transaction (1 DB round-trip).
    // PGliteWorker batches the entire transaction callback into one postMessage
    // exchange, so this is dramatically faster than one transaction per blob.
    //
    // Before starting the DB work, fire off a prefetch for the next batch so
    // the network request runs concurrently with the transaction.
    const cryptoMs = Math.round(performance.now() - cryptoStart);
    const moreToFetch = finalSyncIndex < result.totalCount;
    if (moreToFetch) {
      this.prefetchCache = {
        promise: this.server.getBlobsArrow(
          this.getPublicKeyBase64(),
          finalSyncIndex,
          max
        ),
        startSequence: finalSyncIndex,
        max,
      };
    }
    const dbStart = performance.now();
    // Collect errors inside the transaction; flush them after it commits
    // to avoid deadlocking on a nested pglite.query() call.
    const pendingErrors: Array<{
      errorType: string; errorMessage: string;
      blobSequence?: number; query?: string; params?: any[];
    }> = [];
    if (writeBlobs.length > 0 || finalSyncIndex !== initialLastSyncIndex) {
      await this.pglite.transaction(async (tx) => {
        // Set search_path once for the entire batch
        await tx.exec(this.searchPathSQL);

        for (const { entry, sequenceNumber } of writeBlobs) {
          info(`SYNC APPLYING: Applying blob with sequence ${sequenceNumber}`);
          // Use SAVEPOINTs so that locally-produced blobs (already applied)
          // can be gracefully skipped without rolling back the entire batch.
          // This handles the case where ensureServerPersistence couldn't advance
          // lastSyncIndex due to a gap, and sync later encounters the local blob.
          // @ts-ignore
          await tx.exec(`SAVEPOINT blob_${sequenceNumber}`);
          try {
            if (entry.query === 'TRANSACTION' && Array.isArray(entry.params)) {
              for (const command of entry.params as Array<{ query: string, params?: any[] }>) {
                if (command.query) {
                  // @ts-ignore - PGLite transaction exec has different typing
                  await tx.exec(command.query, command.params);
                }
              }
            } else {
              // @ts-ignore
              await tx.query(entry.query, entry.params || []);
            }
            // @ts-ignore
            await tx.exec(`RELEASE SAVEPOINT blob_${sequenceNumber}`);
          } catch (blobError: any) {
            // Roll back just this blob — likely already applied locally
            // @ts-ignore
            await tx.exec(`ROLLBACK TO SAVEPOINT blob_${sequenceNumber}`);
            error(`SYNC: Failed to apply blob ${sequenceNumber}: query=${entry.query}, params=${JSON.stringify(entry.params)}, error=`, blobError as Error);
            // Defer recording so we don't deadlock inside the transaction
            pendingErrors.push({
              errorType: 'apply_error',
              errorMessage: (blobError as Error).message || String(blobError),
              blobSequence: sequenceNumber,
              query: entry.query,
              params: entry.params,
            });
          }
        }

        // Update sync index once for the entire batch.
        // Use GREATEST to avoid overwriting a higher value set by a concurrent
        // ensureServerPersistence call (e.g. contiguous local writes).
        // @ts-ignore
        await tx.query(
          `UPDATE tributary.streams SET last_sync_index = GREATEST(COALESCE(last_sync_index, 0), $1) WHERE id = $2`,
          [finalSyncIndex, this.getId()]
        );
      });
      // Use Math.max to preserve any higher value set by concurrent local writes
      this.lastSyncIndex = Math.max(this.lastSyncIndex, finalSyncIndex);
    }

    // Flush deferred error records now that the transaction is done
    for (const pe of pendingErrors) {
      await this.recordSyncError(pe.errorType, pe.errorMessage, pe.blobSequence, pe.query, pe.params);
    }
    const dbMs = Math.round(performance.now() - dbStart);

    if (result.blobs.length > 0) {
      const startSeq = result.blobs[0].sequenceNumber;
      const endSeq = result.blobs[result.blobs.length - 1].sequenceNumber;
      info(`SYNC BATCH: Successfully applied ${startSeq}..${endSeq} (crypto ${cryptoMs}ms, db ${dbMs}ms)`);
    }
    
    // Log end sequence number when sync ends
    info(`SYNC END: Last sync index changed from ${initialLastSyncIndex} to ${this.lastSyncIndex}`);
    
    // Return SyncStatus with current and final index
    const syncStatus: SyncStatus = {
      currentIndex: this.lastSyncIndex,
      finalIndex: result.totalCount,
      complete: () => this.lastSyncIndex >= result.totalCount
    };

    info(`SYNC COMPLETE: currentIndex=${syncStatus.currentIndex}, finalIndex=${syncStatus.finalIndex}, complete=${syncStatus.complete()} (fetched ${result.blobs.length})`);
    return syncStatus;
  }

  /**
   * Ensure that a transaction is persisted on the server before confirming locally
   * @param transactionEntry The transaction log entry to persist
   * @param options.skipDbSyncSave When true, skip the DB sync index save (caller manages it).
   *        Required when called inside a PGlite transaction to avoid deadlock.
   * @param options.guardIndex When set, use this as the expected server index instead of
   *        re-fetching from the server. The POST will target guardIndex+1. This ensures the
   *        sequence number is consistent with the sync guard that was already checked.
   */
  private async ensureServerPersistence(
    transactionEntry: TransactionLogEntry,
    options?: { skipDbSyncSave?: boolean; guardIndex?: number }
  ): Promise<void> {
    info('ensureServerPersistence: Starting persistence for transaction', transactionEntry);

    // Get the latest blob metadata from the server for proper chaining.
    // When guardIndex is provided, we already know the expected server state from
    // the sync guard check — but we still need the latest hash for chain verification.
    const latestBlobMetadata = await this.server.getLatestBlobMetadata(this.getPublicKeyBase64());
    debug('ensureServerPersistence: Latest blob metadata from server:', latestBlobMetadata);

    // Use the latest hash from the server for chaining, or empty string if no blobs exist
    const priorHash = latestBlobMetadata ? latestBlobMetadata.hash : '';
    debug('ensureServerPersistence: Using priorHash:', priorHash);

    // Use the next sequence number. When guardIndex is provided (from the sync guard),
    // derive it from there to ensure consistency with what was already checked.
    // Otherwise fall back to the server's latest blob metadata.
    if (options?.guardIndex !== undefined) {
      this.sequenceNumber = options.guardIndex + 1;
    } else {
      this.sequenceNumber = latestBlobMetadata ? latestBlobMetadata.sequenceNumber + 1 : 1;
    }
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
      // This prevents the sync process from re-applying operations that originated locally.
      // IMPORTANT: Only advance if contiguous (sequenceNumber === lastSyncIndex + 1).
      // If there's a gap, it means remote blobs exist between our lastSyncIndex and
      // the new blob that haven't been synced yet. Advancing past them would cause
      // sync to skip those remote blobs permanently.
      if (this.sequenceNumber === this.lastSyncIndex + 1) {
        this.lastSyncIndex = this.sequenceNumber;
        if (!options?.skipDbSyncSave) {
          await this.saveLastSyncIndex();
        }
      } else if (this.sequenceNumber > this.lastSyncIndex + 1) {
        warn(`ensureServerPersistence: Gap detected - wrote sequence ${this.sequenceNumber} but lastSyncIndex is ${this.lastSyncIndex}. Remote blobs need sync before advancing.`);
      }
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
    const { deriveEncryptionKey } = await import('./blobHelpers.js');
    return deriveEncryptionKey(this.privateKey);
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
