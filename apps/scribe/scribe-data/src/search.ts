import { TributaryLocal } from 'tributary-client'

/**
 * Options for search indexing
 */
export interface IndexSearchOptions {
  /**
   * Maximum number of notes to index in one call
   * Defaults to 100
   */
  limit?: number

  /**
   * Optional list of note UUIDs to index.
   * When provided, only these notes are indexed (skipping the scan for unindexed notes).
   * Typically populated from the result of indexSlugs().
   */
  blockUuids?: string[]
}

/**
 * Result of search indexing operation
 */
export interface IndexSearchResult {
  /**
   * Number of notes that were indexed
   */
  indexedCount: number
  
  /**
   * Whether there are more notes to index
   */
  hasMore: boolean
}

/**
 * Options for searching notes
 */
export interface SearchOptions {
  /**
   * Maximum number of results to return
   * Defaults to 20
   */
  limit?: number
  
  /**
   * Number of results to skip (for pagination)
   * Defaults to 0
   */
  offset?: number
}

/**
 * A single search result
 */
export interface SearchResult {
  /**
   * Unique identifier for the note
   */
  block_uuid: string
  
  /**
   * URL-friendly slug (null if note has no title)
   */
  slug: string | null
  
  /**
   * Note title (null if note has no title)
   */
  title: string | null
  
  /**
   * Highlighted excerpt showing search matches
   */
  snippet: string
  
  /**
   * Relevance score (higher is more relevant)
   */
  rank: number
}

interface UnindexedSearchNote {
  block_uuid: string
  version_uuid: string
  body: string
}

/**
 * Extract searchable plain text from markdown body
 * Removes markdown syntax but keeps the actual content
 * 
 * @param body The markdown document body
 * @returns Plain text suitable for full-text indexing
 * 
 * @example
 * extractSearchableText('# Title\n\nThis is **bold** text.')
 * // Returns: 'Title This is bold text'
 */
export function extractSearchableText(body: string): string {
  let text = body
  
  // Remove code blocks (```...```)
  text = text.replace(/```[\s\S]*?```/g, ' ')
  
  // Remove inline code (`...`)
  text = text.replace(/`[^`]+`/g, ' ')
  
  // Remove images ![alt](url) but keep alt text
  text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  
  // Remove links but keep link text [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ')
  
  // Remove headers (# ## ### etc) but keep the text
  text = text.replace(/^#{1,6}\s+/gm, '')
  
  // Remove bold/italic markers but keep the text
  text = text.replace(/(\*\*|__)(.*?)\1/g, '$2')  // **bold** or __bold__
  text = text.replace(/(\*|_)(.*?)\1/g, '$2')      // *italic* or _italic_
  
  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, ' ')
  
  // Remove blockquote markers
  text = text.replace(/^>\s+/gm, '')
  
  // Remove list markers (- * + 1. etc)
  text = text.replace(/^[\s]*[-*+]\s+/gm, '')
  text = text.replace(/^[\s]*\d+\.\s+/gm, '')
  
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ')
  
  // Trim
  text = text.trim()
  
  return text
}

/**
 * Index search vectors for unindexed notes
 * 
 * This function:
 * 1. Finds notes that are indexed in authoritative_version but not in block_search_index
 * 2. Extracts searchable text from each note's markdown body
 * 3. Creates a PostgreSQL tsvector for full-text search
 * 4. Stores the search vector in the block_search_index table
 * 
 * @param localDb The TributaryLocal database instance
 * @param options Indexing options
 * @returns Result indicating how many notes were indexed and if there are more
 */
export async function indexSearchVectors(
  localDb: TributaryLocal,
  options: IndexSearchOptions = {}
): Promise<IndexSearchResult> {
  const limit = options.limit ?? 100
  const { blockUuids } = options

  let unindexedNotes: UnindexedSearchNote[]

  if (blockUuids && blockUuids.length > 0) {
    // Fast path: caller already knows which notes need indexing (e.g. from indexSlugs).
    // Just fetch their authoritative content directly -- no scan required.
    const placeholders = blockUuids.map((_, i) => `$${i + 1}`).join(', ')
    const result = await localDb.query(`
      SELECT
        b.block_uuid,
        b.version_uuid,
        b.body
      FROM block b
      INNER JOIN authoritative_version av
        ON b.block_uuid = av.block_uuid
        AND b.version_uuid = av.version_uuid
      WHERE b.block_uuid IN (${placeholders})
    `, blockUuids)

    unindexedNotes = (result.rows || []) as UnindexedSearchNote[]
  } else {
    // Fallback: scan for notes that are authoritative but not yet search-indexed
    const result = await localDb.query(`
      SELECT
        b.block_uuid,
        b.version_uuid,
        b.body
      FROM block b
      INNER JOIN authoritative_version av
        ON b.block_uuid = av.block_uuid
        AND b.version_uuid = av.version_uuid
      LEFT JOIN block_search_index bsi
        ON b.block_uuid = bsi.block_uuid
      WHERE bsi.block_uuid IS NULL
        OR bsi.version_uuid != av.version_uuid
      ORDER BY b.insert_datetime ASC
      LIMIT $1
    `, [limit])

    unindexedNotes = (result.rows || []) as UnindexedSearchNote[]
  }

  if (unindexedNotes.length === 0) {
    return {
      indexedCount: 0,
      hasMore: false
    }
  }

  console.log(`indexSearchVectors: ${unindexedNotes.length} notes to update`)
  const searchStartTime = performance.now()

  // Index all notes in a single transaction for atomicity and performance
  let indexedCount = 0

  await localDb.transaction(async (tx: any) => {
    for (const note of unindexedNotes) {
      const searchableText = extractSearchableText(note.body)
      const now = new Date().toISOString()

      if (searchableText.trim().length > 0) {
        await tx.query(
          `INSERT INTO block_search_index (block_uuid, version_uuid, search_vector, indexed_at)
           VALUES ($1, $2, to_tsvector('english', $3), $4)
           ON CONFLICT (block_uuid)
           DO UPDATE SET
             version_uuid = $2,
             search_vector = to_tsvector('english', $3),
             indexed_at = $4`,
          [note.block_uuid, note.version_uuid, searchableText, now]
        )
        indexedCount++
      } else {
        await tx.query(
          `DELETE FROM block_search_index WHERE block_uuid = $1`,
          [note.block_uuid]
        )
      }
    }
  })

  const searchElapsed = (performance.now() - searchStartTime).toFixed(1)
  console.log(`indexSearchVectors: updated ${indexedCount} search vectors in ${searchElapsed}ms`)

  return {
    indexedCount,
    // When blockUuids was provided, hasMore is always false (caller gave us the exact set)
    hasMore: blockUuids ? false : unindexedNotes.length === limit
  }
}

/**
 * Search notes using full-text search
 * 
 * Uses PostgreSQL's full-text search capabilities to find notes matching the query.
 * Returns results ranked by relevance with highlighted snippets.
 * 
 * @param localDb The TributaryLocal database instance
 * @param query The search query (can be multiple words)
 * @param options Search options (limit, offset)
 * @returns Array of search results ordered by relevance
 * 
 * @example
 * const results = await searchNotes(db, 'javascript tutorial')
 * // Returns notes containing "javascript" and "tutorial", ranked by relevance
 */
export async function searchNotes(
  localDb: TributaryLocal,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const limit = options.limit ?? 20
  const offset = options.offset ?? 0
  
  // If query is empty, return empty results
  if (!query || query.trim().length === 0) {
    return []
  }
  
  // Convert query to tsquery format
  // Split on whitespace and join with & (AND operator)
  const queryTerms = query.trim().split(/\s+/).join(' & ')
  
  try {
    const result = await localDb.query(
      `WITH RECURSIVE coll_path(collection_uuid, path) AS (
         -- Base case: library roots have empty path
         SELECT c.collection_uuid, ''::text AS path
         FROM collection c
         WHERE c.parent_collection_uuid IS NULL

         UNION ALL

         -- Recursive: child collections build path from parent
         SELECT cs.collection_uuid,
           CASE WHEN cp.path = '' THEN cs.slug
                ELSE cp.path || '/' || cs.slug
           END AS path
         FROM collection_slug cs
         INNER JOIN coll_path cp ON cs.parent_collection_uuid = cp.collection_uuid
       )
       SELECT
         b.block_uuid,
         CASE
           WHEN bs.slug IS NOT NULL AND cp.path IS NOT NULL AND cp.path != ''
           THEN cp.path || '/' || bs.slug
           ELSE bs.slug
         END AS slug,
         bs.title,
         ts_rank(bsi.search_vector, query) AS rank,
         ts_headline('english', b.body, query,
           'MaxWords=30, MinWords=15, MaxFragments=1, FragmentDelimiter=" ... "'
         ) AS snippet
       FROM block_search_index bsi
       INNER JOIN block b
         ON bsi.block_uuid = b.block_uuid
         AND bsi.version_uuid = b.version_uuid
       LEFT JOIN block_slug bs
         ON b.block_uuid = bs.block_uuid
       LEFT JOIN coll_path cp
         ON b.collection_id = cp.collection_uuid
       CROSS JOIN to_tsquery('english', $1) query
       WHERE bsi.search_vector @@ query
       ORDER BY rank DESC, bs.title ASC NULLS LAST
       LIMIT $2 OFFSET $3`,
      [queryTerms, limit, offset]
    )
    
    return (result.rows || []).map((row: any) => ({
      block_uuid: row.block_uuid,
      slug: row.slug || null,
      title: row.title || null,
      snippet: row.snippet || '',
      rank: parseFloat(row.rank) || 0
    }))
  } catch (error) {
    console.error('Error searching notes:', error)
    // Return empty results on error (e.g., invalid query syntax)
    return []
  }
}
