import { TributaryLocal } from 'tributary-client'

/**
 * Options for search indexing
 */
export interface IndexSearchOptions {
  /**
   * Maximum number of blocks to index in one call
   * Defaults to 100
   */
  limit?: number
}

/**
 * Result of search indexing operation
 */
export interface IndexSearchResult {
  /**
   * Number of blocks that were indexed
   */
  indexedCount: number
  
  /**
   * Whether there are more blocks to index
   */
  hasMore: boolean
}

/**
 * Options for searching blocks
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
   * Unique identifier for the block
   */
  block_uuid: string
  
  /**
   * URL-friendly slug (null if block has no title)
   */
  slug: string | null
  
  /**
   * Block title (null if block has no title)
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

interface UnindexedSearchBlock {
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
 * Index search vectors for unindexed blocks
 * 
 * This function:
 * 1. Finds blocks that are indexed in authoritative_version but not in block_search_index
 * 2. Extracts searchable text from each block's markdown body
 * 3. Creates a PostgreSQL tsvector for full-text search
 * 4. Stores the search vector in the block_search_index table
 * 
 * @param localDb The TributaryLocal database instance
 * @param options Indexing options
 * @returns Result indicating how many blocks were indexed and if there are more
 */
export async function indexSearchVectors(
  localDb: TributaryLocal,
  options: IndexSearchOptions = {}
): Promise<IndexSearchResult> {
  const limit = options.limit ?? 100
  
  // Find blocks that are authoritative but not search-indexed (or have a newer version)
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
  
  const unindexedBlocks: UnindexedSearchBlock[] = (result.rows || []) as UnindexedSearchBlock[]
  
  if (unindexedBlocks.length === 0) {
    return {
      indexedCount: 0,
      hasMore: false
    }
  }
  
  // Index each block
  let indexedCount = 0
  
  for (const block of unindexedBlocks) {
    try {
      const searchableText = extractSearchableText(block.body)
      
      if (searchableText.trim().length > 0) {
        // Insert or update the search vector
        await localDb.query(
          `INSERT INTO block_search_index (block_uuid, version_uuid, search_vector, indexed_at)
           VALUES ($1, $2, to_tsvector('english', $3), $4)
           ON CONFLICT (block_uuid)
           DO UPDATE SET 
             version_uuid = $2,
             search_vector = to_tsvector('english', $3),
             indexed_at = $4`,
          [
            block.block_uuid,
            block.version_uuid,
            searchableText,
            new Date().toISOString()
          ]
        )
        indexedCount++
      } else {
        // If no searchable text, remove from search index
        await localDb.query(
          `DELETE FROM block_search_index WHERE block_uuid = $1`,
          [block.block_uuid]
        )
      }
    } catch (error) {
      console.error(`Error indexing search vector for block ${block.block_uuid}:`, error)
      // Continue with other blocks
    }
  }
  
  return {
    indexedCount,
    hasMore: unindexedBlocks.length === limit
  }
}

/**
 * Search blocks using full-text search
 * 
 * Uses PostgreSQL's full-text search capabilities to find blocks matching the query.
 * Returns results ranked by relevance with highlighted snippets.
 * 
 * @param localDb The TributaryLocal database instance
 * @param query The search query (can be multiple words)
 * @param options Search options (limit, offset)
 * @returns Array of search results ordered by relevance
 * 
 * @example
 * const results = await searchBlocks(db, 'javascript tutorial')
 * // Returns blocks containing "javascript" and "tutorial", ranked by relevance
 */
export async function searchBlocks(
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
      `SELECT 
         b.block_uuid,
         bs.slug,
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
    console.error('Error searching blocks:', error)
    // Return empty results on error (e.g., invalid query syntax)
    return []
  }
}
