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
 * Estimate the on-disk size (in bytes) of all tables in a given schema.
 *
 * Tries `pg_total_relation_size()` first (fast, accurate). If that returns 0
 * or is unavailable in PGlite, falls back to summing `pg_column_size()` over
 * every row plus a per-row overhead estimate.
 */
export async function estimateStreamStorageBytes(
  pglite: PGliteInterface,
  schemaName: string
): Promise<StreamStorageEstimate> {
  // Try pg_total_relation_size first
  try {
    const result: any = await pglite.query(
      `SELECT
         COALESCE(SUM(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))), 0)::bigint AS total_bytes
       FROM pg_tables
       WHERE schemaname = $1`,
      [schemaName]
    )
    const totalBytes = Number(result.rows[0]?.total_bytes ?? 0)

    if (totalBytes > 0) {
      const rowCount = await countAllRows(pglite, schemaName)
      return { estimatedBytes: totalBytes, rowCount }
    }
  } catch {
    // pg_total_relation_size not available, fall through to fallback
  }

  // Fallback: sum pg_column_size over every row in every table
  return estimateFromColumnSizes(pglite, schemaName)
}

/**
 * Fallback estimation: sum pg_column_size() over all rows in each table,
 * plus a per-row overhead for tuple headers and indexes.
 */
async function estimateFromColumnSizes(
  pglite: PGliteInterface,
  schemaName: string
): Promise<StreamStorageEstimate> {
  const tables = await listTables(pglite, schemaName)
  let estimatedBytes = 0
  let rowCount = 0

  for (const table of tables) {
    try {
      const fqn = `${quoteIdent(schemaName)}.${quoteIdent(table)}`
      const result: any = await pglite.query(
        `SELECT COUNT(*)::int AS cnt,
                COALESCE(SUM(pg_column_size(t.*)), 0)::bigint AS data_bytes
         FROM ${fqn} t`
      )
      const row = result.rows[0]
      const cnt = row?.cnt ?? 0
      const dataBytes = Number(row?.data_bytes ?? 0)
      rowCount += cnt
      // Add ~100 bytes per row for tuple header, alignment, index overhead
      estimatedBytes += dataBytes + cnt * 100
    } catch {
      // table may have been dropped concurrently; skip
    }
  }

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
      const r: any = await pglite.query(`SELECT COUNT(*)::int AS cnt FROM ${fqn}`)
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
  const result: any = await pglite.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1`,
    [schemaName]
  )
  return (result.rows ?? []).map((r: any) => r.tablename)
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
