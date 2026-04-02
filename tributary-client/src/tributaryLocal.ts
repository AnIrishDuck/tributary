// TributaryLocal class for local (non-synced) database operations
import { PGliteInterface } from '@electric-sql/pglite';
import { logger, debug } from './logger.js';

export class TributaryLocal {
  private pglite: PGliteInterface;
  private schemaName: string;
  private searchPathSQL: string;

  /** Default tracking table used by migrate() / hasMigration(). */
  readonly defaultMigrationsTable = 'local_migrations';

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
  async query(query: string, params?: any[]) {
    // Wrap in a transaction with SET LOCAL search_path so the search_path
    // is scoped to this operation and cannot be changed by concurrent streams.
    return await this.pglite.transaction(async (tx) => {
      await tx.exec(this.searchPathSQL);
      // @ts-ignore
      return await tx.query(query, params);
    });
  }

  /**
   * Execute SQL command with persistence guarantee (for commands that don't return results)
   * @param query SQL command to execute
   * @param params Command parameters
   */
  async exec(query: string, params?: any[]) {
    return await this.pglite.transaction(async (tx) => {
      await tx.exec(this.searchPathSQL);
      // Use query instead of exec for parameterized operations to work around PGLite issue
      // @ts-ignore
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
  async transaction<T>(callback: (tx: any) => Promise<T>) {
    // Set search_path inside the transaction so it's scoped and cannot
    // be changed by concurrent operations on other streams.
    return await this.pglite.transaction(async (tx) => {
      await tx.exec(this.searchPathSQL);
      return await callback(tx);
    });
  }
}
