import { TributaryClient } from 'tributary-client'
import { 
  CompiledQuery,
  DatabaseConnection,
  QueryResult,
  TransactionSettings,
  Dialect,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler
} from 'kysely'
import { TributaryDriver } from './tributary-driver.js'

export class KyselyTributary {
  client: TributaryClient

  /**
   * Create a new KyselyTributary instance.
   * @param client The TributaryClient instance to use for database operations
   */
  constructor(client: TributaryClient) {
    this.client = client
  }

  dialect: Dialect = {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new TributaryDriver(this.client),
    createIntrospector: (db: Kysely<any>) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  }
}
