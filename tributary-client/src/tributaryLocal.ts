// TributaryLocal class for local (non-synced) database operations
import { PGlite } from '@electric-sql/pglite';
import { logger, debug } from './logger.js';

export class TributaryLocal {
  private pglite: PGlite;
  private schemaName: string;

  constructor(pglite: PGlite, schemaName: string) {
    this.pglite = pglite;
    this.schemaName = schemaName;
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
   * Set the search path to include this stream's schema first
   */
  private async setSearchPath(): Promise<void> {
    await this.pglite.exec(`SET search_path TO ${this.schemaName}, tributary, public`);
  }

  /**
   * Execute SQL query with persistence guarantee
   * @param query SQL query to execute
   * @param params Query parameters
   * @returns Query result
   */
  async query(query: string, params?: any[]) {
    // Set the search path to ensure we're operating on the correct schema
    await this.setSearchPath();
    
    // @ts-ignore
    return await this.pglite.query(query, params);
  }

  /**
   * Execute SQL command with persistence guarantee (for commands that don't return results)
   * @param query SQL command to execute
   * @param params Command parameters
   */
  async exec(query: string, params?: any[]) {
    // Set the search path to ensure we're operating on the correct schema
    await this.setSearchPath();
    
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
    // Set the search path to ensure we're operating on the correct schema
    await this.setSearchPath();
    
    // Execute the transaction using the underlying PGLite transaction method
    return await this.pglite.transaction(callback);
  }
}
