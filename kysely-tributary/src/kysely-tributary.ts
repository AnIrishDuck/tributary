import { TributaryClient, TributaryStream, TributaryLocal } from 'tributary-client'
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

// Type for objects that can be used with TributaryDriver
type TributaryQueryable = TributaryStream | TributaryLocal;

export class KyselyTributary {
  stream: TributaryQueryable

  /**
   * Create a new KyselyTributary instance.
   * @param stream The TributaryStream or TributaryLocal instance to use for database operations
   */
  constructor(stream: TributaryQueryable) {
    this.stream = stream
  }

  dialect: Dialect = {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new TributaryDriver(this.stream),
    createIntrospector: (db: Kysely<any>) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  }
}
