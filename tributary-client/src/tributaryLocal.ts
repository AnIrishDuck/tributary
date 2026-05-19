// TributaryLocal class for local (non-synced) database operations
import { PGliteInterface } from '@electric-sql/pglite';
import { logger, debug } from './logger.js';
import type { StreamTransaction } from './tributaryStream.js';

export class TributaryLocal {
  private pglite: PGliteInterface;
  private schemaName: string;
  private searchPathSQL: string;

  /** Default tracking table used by migrate() / hasMigration(). */
  readonly defaultMigrationsTable = 'local_migrations';

  /** TributaryLocal does not produce blobs. */
  readonly lastBlobIndex: null = null;

  constructor(pglite: PGliteInterface, schemaName: string) {
    this.pglite = pglite;
    this.schemaName = schemaName;
    // Pre-compute the SET LOCAL statement to avoid string building on every call.
    // SET LOCAL scopes the search_path to the current transaction, preventing
    // concurrent operations on other streams from stomping on it.
    this.searchPathSQL = `SET LOCAL search_path TO "${schemaName}", tributary, public`;
  }

  /**
   * Gets the fully qualified table name given a short table name.
   * @param table The short table name
   * @returns The fully qualified table name with schema
   */
  getFullTable(table: string): string {
    return `"${this.schemaName}"."${table}"`;
  }

  /**
   * Execute SQL query with persistence guarantee
   * @param query SQL query to execute
   * @param params Query parameters
   * @returns Query result
   */
  async query(query: string, params?: unknown[]) {
    // Wrap in a transaction with SET LOCAL search_path so the search_path
    // is scoped to this operation and cannot be changed by concurrent streams.
    return await this.pglite.transaction(async (tx) => {
      await tx.exec(this.searchPathSQL);
      return await tx.query(query, params);
    });
  }

  /**
   * Execute SQL command with persistence guarantee (for commands that don't return results)
   * @param query SQL command to execute
   * @param params Command parameters
   */
  async exec(query: string, params?: unknown[]) {
    return await this.pglite.transaction(async (tx) => {
      await tx.exec(this.searchPathSQL);
      if (params && params.length > 0) {
        await tx.query(query, params);
      } else {
        await tx.exec(query);
      }
    });
  }

  /**
   * Execute SQL transaction with persistence guarantee
   * @param callback Transaction callback
   * @returns Transaction result
   */
  async transaction<T>(callback: (tx: StreamTransaction) => Promise<T>) {
    return await this.pglite.transaction(async (tx) => {
      await tx.exec(this.searchPathSQL);
      const wrappedTx: StreamTransaction = {
        query: <T>(query: string, params?: unknown[]) => tx.query<T>(query, params as any[]),
        exec: async (query, params) => {
          if (params && params.length > 0) {
            await tx.query(query, params as any[]);
          } else {
            await tx.exec(query);
          }
        }
      };
      return await callback(wrappedTx);
    });
  }
}
