import { PGliteInterface } from '@electric-sql/pglite'

export interface LibraryStorageEstimate {
  streamId: string
  title: string
  estimatedBytes: number
  noteCount: number
}

export interface AllLibraryStorageResult {
  libraries: LibraryStorageEstimate[]
  totalBytes: number
}

export interface QuotaEstimate {
  usage: number
  quota: number
}

/**
 * Estimate the on-disk size (in bytes) of all tables in a given schema.
 *
 * Tries `pg_total_relation_size()` first (fast, accurate). If that fails
 * (some PGlite builds don't expose the full pg_catalog), falls back to
 * summing `octet_length()` over the `block` table's text columns and
 * counting rows in other tables with a fixed per-row estimate.
 */
export async function estimateStreamStorageBytes(
  pglite: PGliteInterface,
  schemaName: string
): Promise<{ estimatedBytes: number; noteCount: number }> {
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

    // Also get note count
    let noteCount = 0
    try {
      const countResult: any = await pglite.query(
        `SELECT COUNT(DISTINCT block_uuid)::int AS cnt FROM ${quoteIdent(schemaName)}.block`
      )
      noteCount = countResult.rows[0]?.cnt ?? 0
    } catch {
      // block table may not exist
    }

    // pg_total_relation_size returns 0 for schemas with no data, which is valid.
    // But if it returned a meaningful value (> 0), use it.
    if (totalBytes > 0) {
      return { estimatedBytes: totalBytes, noteCount }
    }
  } catch {
    // pg_total_relation_size not available, fall through to fallback
  }

  // Fallback: estimate from actual data in the block table
  return estimateFromBlockData(pglite, schemaName)
}

/**
 * Fallback estimation: sum octet_length of text columns in the block table
 * plus a per-row overhead estimate for other tables.
 */
async function estimateFromBlockData(
  pglite: PGliteInterface,
  schemaName: string
): Promise<{ estimatedBytes: number; noteCount: number }> {
  const schema = quoteIdent(schemaName)
  let estimatedBytes = 0
  let noteCount = 0

  // Estimate block table size using octet_length on all text columns
  try {
    const result: any = await pglite.query(
      `SELECT
         COUNT(*)::int AS row_count,
         COUNT(DISTINCT block_uuid)::int AS note_count,
         COALESCE(SUM(
           octet_length(block_uuid) +
           octet_length(block_type) +
           octet_length(version_uuid) +
           COALESCE(octet_length(prior_version_uuid), 0) +
           octet_length(insert_datetime) +
           octet_length(inserter) +
           octet_length(body) +
           COALESCE(octet_length(collection_id), 0) +
           octet_length(slug)
         ), 0)::bigint AS data_bytes
       FROM ${schema}.block`
    )
    const row = result.rows[0]
    noteCount = row?.note_count ?? 0
    const dataBytes = Number(row?.data_bytes ?? 0)
    const rowCount = row?.row_count ?? 0
    // Add ~100 bytes per row for tuple header, alignment, index overhead
    estimatedBytes += dataBytes + rowCount * 100
  } catch {
    // block table may not exist
  }

  // Estimate collection table size
  try {
    const result: any = await pglite.query(
      `SELECT
         COUNT(*)::int AS row_count,
         COALESCE(SUM(
           octet_length(collection_uuid) +
           octet_length(title) +
           COALESCE(octet_length(parent_collection_uuid), 0) +
           octet_length(insert_datetime) +
           octet_length(inserter) +
           COALESCE(octet_length(linked_stream_id), 0) +
           COALESCE(octet_length(linked_stream_key), 0) +
           octet_length(slug)
         ), 0)::bigint AS data_bytes
       FROM ${schema}.collection`
    )
    const row = result.rows[0]
    const dataBytes = Number(row?.data_bytes ?? 0)
    const rowCount = row?.row_count ?? 0
    estimatedBytes += dataBytes + rowCount * 100
  } catch {
    // collection table may not exist
  }

  return { estimatedBytes, noteCount }
}

/**
 * Estimate storage for all libraries known to this PGlite instance.
 *
 * Reads streams from `tributary.streams`, estimates each stream's size,
 * and maps stream IDs to human-readable library names using the
 * `linked_libraries` cache and the home stream's `collection` table.
 */
export async function estimateAllLibraryStorage(
  pglite: PGliteInterface,
  homeStreamId: string
): Promise<AllLibraryStorageResult> {
  // Get all streams
  const streamsResult: any = await pglite.query(
    `SELECT id, schema_id FROM tributary.streams`
  )
  const streams: Array<{ id: string; schema_id: string }> = streamsResult.rows ?? []

  // Build a title map from linked_libraries cache + home collection table
  const titleMap = new Map<string, string>()

  // Try linked_libraries cache (on home stream's local schema)
  const homeStream = streams.find(s => s.id === homeStreamId)
  if (homeStream) {
    const homeSchema = quoteIdent(`scribe_${homeStream.schema_id}`)
    try {
      const cached: any = await pglite.query(
        `SELECT stream_id, title FROM ${homeSchema}.linked_libraries`
      )
      for (const row of cached.rows ?? []) {
        titleMap.set(row.stream_id, row.title)
      }
    } catch {
      // Table may not exist
    }

    // Also check collection table for linked libraries (may have entries not yet cached)
    try {
      const collections: any = await pglite.query(
        `SELECT linked_stream_id, title FROM ${homeSchema}.collection
         WHERE linked_stream_id IS NOT NULL`
      )
      for (const row of collections.rows ?? []) {
        if (row.linked_stream_id && !titleMap.has(row.linked_stream_id)) {
          titleMap.set(row.linked_stream_id, row.title)
        }
      }
    } catch {
      // Table may not exist
    }

    // The home stream itself: get its root collection title
    try {
      const rootResult: any = await pglite.query(
        `SELECT title FROM ${homeSchema}.collection
         WHERE parent_collection_uuid IS NULL
         LIMIT 1`
      )
      if (rootResult.rows?.length > 0) {
        titleMap.set(homeStreamId, rootResult.rows[0].title)
      }
    } catch {
      // Table may not exist
    }
  }

  // Estimate each stream
  const libraries: LibraryStorageEstimate[] = []
  let totalBytes = 0

  for (const stream of streams) {
    const schemaName = `scribe_${stream.schema_id}`
    const { estimatedBytes, noteCount } = await estimateStreamStorageBytes(pglite, schemaName)
    const title = titleMap.get(stream.id) ?? stream.id
    libraries.push({ streamId: stream.id, title, estimatedBytes, noteCount })
    totalBytes += estimatedBytes
  }

  return { libraries, totalBytes }
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
  // Double any embedded double-quotes, then wrap in double-quotes
  return `"${name.replace(/"/g, '""')}"`
}
