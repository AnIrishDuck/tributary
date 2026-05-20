import { TributaryStream } from 'tributary-client'

// Re-export generic storage utilities from tributary-client
export { estimateStreamStorageBytes, estimateQuota } from 'tributary-client'
export type { StreamStorageEstimate, QuotaEstimate } from 'tributary-client'

export interface LibraryStorageEstimate {
  streamId: string
  title: string
  estimatedBytes: number
  noteCount: number
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
 * Count distinct notes in a stream via its TributaryStream handle.
 */
async function countNotes(stream: TributaryStream): Promise<number> {
  try {
    const result = await stream.query(
      `SELECT COUNT(DISTINCT block_uuid)::int AS cnt FROM block`
    )
    const row = result.rows[0] as { cnt: number } | undefined
    return row?.cnt ?? 0
  } catch {
    return 0
  }
}
