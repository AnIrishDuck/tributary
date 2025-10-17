import { TributaryClient, TributaryStream } from 'tributary-client'
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
  stream: TributaryStream

  /**
   * Create a new KyselyTributary instance.
   * @param stream The TributaryStream instance to use for database operations
   */
  constructor(stream: TributaryStream) {
    this.stream = stream
  }

  dialect: Dialect = {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new TributaryDriver(this.stream),
    createIntrospector: (db: Kysely<any>) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  }
}
