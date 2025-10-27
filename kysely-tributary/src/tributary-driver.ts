import { TributaryStream, TributaryLocal } from 'tributary-client'
import {
  CompiledQuery,
  DatabaseConnection,
  QueryResult,
  TransactionSettings,
} from 'kysely'

// Type for objects that have query and exec methods
type Queryable = TributaryStream | TributaryLocal;

export class TributaryDriver {
  private stream: Queryable

  constructor(stream: Queryable) {
    this.stream = stream
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new TributaryConnection(this.stream)
  }

  async beginTransaction(
    connection: DatabaseConnection,
    _settings: TransactionSettings,
  ): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('BEGIN'))
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('COMMIT'))
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('ROLLBACK'))
  }

  async destroy(): Promise<void> {
    // Queryable objects don't have a close method, but we could add one if needed
  }

  async init(): Promise<void> {}
  async releaseConnection(_connection: DatabaseConnection): Promise<void> {}
}

class TributaryConnection implements DatabaseConnection {
  private stream: Queryable

  constructor(stream: Queryable) {
    this.stream = stream
  }

  async executeQuery<R>(
    compiledQuery: CompiledQuery<any>,
  ): Promise<QueryResult<R>> {
    // Route all queries through the Queryable object
    // The object will automatically handle read vs write operations
    // and ensure persistence guarantees for write operations
    const result = await this.stream.query(compiledQuery.sql, [
      ...compiledQuery.parameters,
    ]);
    // Cast to QueryResult<R> to match Kysely's expected return type
    return result as QueryResult<R>;
  }

  async *streamQuery(): AsyncGenerator<never, void, unknown> {
    throw new Error('Queryable objects do not support streaming.')
  }
}
