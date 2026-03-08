import { PGliteInterface } from '@electric-sql/pglite'
import { TributaryStream, estimateStreamStorageBytes } from 'tributary-client'

// Re-export generic storage utilities from tributary-client
export { estimateStreamStorageBytes, estimateQuota } from 'tributary-client'
export type { StreamStorageEstimate, QuotaEstimate } from 'tributary-client'

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

/**
 * Estimate storage for a single library (stream), including its note count.
 */
export async function estimateLibraryStorage(
  stream: TributaryStream
): Promise<LibraryStorageEstimate> {
  const { estimatedBytes } = await stream.estimateStorage()
  const noteCount = await countNotes(stream)
  return {
    streamId: stream.getId(),
    title: stream.getId(),
    estimatedBytes,
    noteCount,
  }
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
  const titleMap = await buildTitleMap(pglite, streams, homeStreamId)

  // Estimate each stream
  const libraries: LibraryStorageEstimate[] = []
  let totalBytes = 0

  for (const stream of streams) {
    const schemaName = `scribe_${stream.schema_id}`
    const { estimatedBytes, rowCount } = await estimateStreamStorageBytes(pglite, schemaName)
    const noteCount = await countNotesInSchema(pglite, schemaName)
    const title = titleMap.get(stream.id) ?? stream.id
    libraries.push({ streamId: stream.id, title, estimatedBytes, noteCount })
    totalBytes += estimatedBytes
  }

  return { libraries, totalBytes }
}

/**
 * Count distinct notes in a stream via its TributaryStream handle.
 */
async function countNotes(stream: TributaryStream): Promise<number> {
  try {
    const result: any = await stream.query(
      `SELECT COUNT(DISTINCT block_uuid)::int AS cnt FROM block`
    )
    return result.rows[0]?.cnt ?? 0
  } catch {
    return 0
  }
}

/**
 * Count distinct notes in a schema by name (used when we only have the raw schema name).
 */
async function countNotesInSchema(
  pglite: PGliteInterface,
  schemaName: string
): Promise<number> {
  try {
    const result: any = await pglite.query(
      `SELECT COUNT(DISTINCT block_uuid)::int AS cnt FROM ${quoteIdent(schemaName)}.block`
    )
    return result.rows[0]?.cnt ?? 0
  } catch {
    return 0
  }
}

/**
 * Build a map from stream ID → library title using the home stream's
 * linked_libraries cache and collection table.
 */
async function buildTitleMap(
  pglite: PGliteInterface,
  streams: Array<{ id: string; schema_id: string }>,
  homeStreamId: string
): Promise<Map<string, string>> {
  const titleMap = new Map<string, string>()

  const homeStream = streams.find(s => s.id === homeStreamId)
  if (!homeStream) return titleMap

  const homeSchema = quoteIdent(`scribe_${homeStream.schema_id}`)

  // linked_libraries cache
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

  // collection table for linked libraries not yet cached
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

  // Home stream root collection title
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

  return titleMap
}

/** Quote a SQL identifier to prevent injection. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}
