import { PGliteInterface } from '@electric-sql/pglite'

export interface StreamStorageEstimate {
  /** Estimated bytes used by all tables in the stream's schema */
  estimatedBytes: number
  /** Number of rows across all tables (best-effort) */
  rowCount: number
}

export interface QuotaEstimate {
  usage: number
  quota: number
}

/**
 * Estimate the on-disk size (in bytes) of all tables in a given schema
 * using `pg_total_relation_size()`.
 */
export async function estimateStreamStorageBytes(
  pglite: PGliteInterface,
  schemaName: string
): Promise<StreamStorageEstimate> {
  const result = await pglite.query<{ total_bytes: string }>(
    `SELECT
       COALESCE(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))), 0)::bigint AS total_bytes
     FROM pg_tables
     WHERE schemaname = $1`,
    [schemaName]
  )
  const estimatedBytes = Number(result.rows[0]?.total_bytes ?? 0)
  const rowCount = await countAllRows(pglite, schemaName)
  return { estimatedBytes, rowCount }
}

/**
 * Count all rows across all tables in a schema.
 */
async function countAllRows(
  pglite: PGliteInterface,
  schemaName: string
): Promise<number> {
  const tables = await listTables(pglite, schemaName)
  let total = 0
  for (const table of tables) {
    try {
      const fqn = `${quoteIdent(schemaName)}.${quoteIdent(table)}`
      const r = await pglite.query<{ cnt: number }>(`SELECT COUNT(*)::int AS cnt FROM ${fqn}`)
      total += r.rows[0]?.cnt ?? 0
    } catch {
      // skip
    }
  }
  return total
}

/**
 * List all user tables in a schema.
 */
async function listTables(
  pglite: PGliteInterface,
  schemaName: string
): Promise<string[]> {
  const result = await pglite.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
    [schemaName]
  )
  return (result.rows ?? []).map((r) => r.tablename)
}

/**
 * Estimate browser storage quota and usage via the Storage API.
 *
 * Returns `null` when `navigator.storage.estimate()` is unavailable
 * (e.g. in Node/test environments or unsupported browsers).
 */
export async function estimateQuota(): Promise<QuotaEstimate | null> {
  try {
    if (
      typeof navigator === 'undefined' ||
      !navigator.storage ||
      typeof navigator.storage.estimate !== 'function'
    ) {
      return null
    }
    const estimate = await navigator.storage.estimate()
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? 0,
    }
  } catch {
    return null
  }
}

/** Quote a SQL identifier to prevent injection. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}
