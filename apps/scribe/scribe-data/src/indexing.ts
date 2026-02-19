import { TributaryLocal } from 'tributary-client'
import { Block, BlockSlug, AuthoritativeVersion, BlockTag, PGliteResult, BlockSlugRow } from './types'


// Add proper typing for the query results
interface UnindexedBlock {
  block_uuid: string;
  version_uuid: string;
  body: string;
  insert_datetime: string;
}

interface ExistingSlugResult {
  block_uuid: string;
}

interface ExistingBlockResult {
  block_uuid: string;
  body: string;
}

interface LastEditedResult {
  last_edited: string | null;
}

/**
 * Extract the title from a markdown document body
 * The title is the first H1 heading (# Title) in the document
 * @param body The markdown document body
 * @returns The extracted title or null if no title found
 */
export function extractTitleFromMarkdown(body: string): string | null {
  // Match the first H1 heading: # Title
  // This regex looks for:
  // - Start of line (^) or newline
  // - Optional whitespace
  // - # followed by whitespace
  // - Capture everything until end of line
  const titleRegex = /^[\s]*#[\s]+(.+)$/m
  const match = body.match(titleRegex)
  
  if (match && match[1]) {
    // Trim whitespace and return the title
    return match[1].trim()
  }
  
  return null
}

/**
 * Convert a title to a URL-friendly slug
 * @param title The title to convert
 * @returns The slug version of the title
 */
export function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-')         // Replace spaces with hyphens
    .replace(/-+/g, '-')          // Replace multiple hyphens with single
    .replace(/^-|-$/g, '')        // Remove leading/trailing hyphens
}

/**
 * Generate a unique slug by appending UUID fragments
 * Implements the algorithm from apps/scribe/docs/slugs.md:
 * - If multiple docs have same title, first 4 chars of UUID are appended
 * - If still conflicting, continue adding UUID chunks until unique
 * - Handles titles with UUID-like fragments
 *
 * @param baseSlug The base slug to make unique
 * @param blockUuid The UUID of the current block
 * @param db Database transaction
 * @returns A unique slug with UUID fragments appended as needed
 */
export async function generateUniqueSlug(baseSlug: string, blockUuid: string, db: TributaryLocal): Promise<string> {
  // Find all existing blocks with the exact same base slug
  const result = await db.query(
    `SELECT block_uuid FROM block_slug WHERE slug = $1`,
    [baseSlug]
  )

  const existingBlocks = result.rows || []

  // If no conflicts, return base slug
  if (existingBlocks.length === 0) {
    return baseSlug
  }

  // We have conflicts, need to add UUID fragments
  // According to the spec, when there are conflicts, we need to suffix ALL blocks

  // First, check if the current block already has a unique slug with a suffix
  // Try with 4-character suffix first
  const suffix4 = blockUuid.substring(0, 4)
  const slugWith4CharSuffix = `${baseSlug}-${suffix4}`

  // Check if this conflicts with any existing slug
  const existingResult = await db.query(
    `SELECT block_uuid FROM block_slug WHERE slug = $1 AND block_uuid != $2`,
    [slugWith4CharSuffix, blockUuid]
  )

  const existingSlugWith4Suffix = existingResult.rows && existingResult.rows.length > 0 ? existingResult.rows[0] : null

  if (!existingSlugWith4Suffix) {
    return slugWith4CharSuffix
  }

  // If 4-char suffix still conflicts, we need to keep adding more UUID characters
  // until we get a unique slug
  let fragmentLength = 9  // 8 characters (two 4-char segments) + 1 hyphen

  while (fragmentLength <= blockUuid.length) {
    const suffix = blockUuid.substring(0, fragmentLength)
    const slugWithSuffix = `${baseSlug}-${suffix}`

    // Check if this conflicts with any existing slug
    const existingSuffixResult = await db.query(
      `SELECT block_uuid FROM block_slug WHERE slug = $1 AND block_uuid != $2`,
      [slugWithSuffix, blockUuid]
    )

    const existingSlugWithSuffix = existingSuffixResult.rows && existingSuffixResult.rows.length > 0 ? existingSuffixResult.rows[0] : null

    if (!existingSlugWithSuffix) {
      return slugWithSuffix
    }

    // Increase fragment length
    fragmentLength += 5  // 4 more chars + 1 hyphen

    // Safety check
    if (fragmentLength > blockUuid.length) {
      return `${baseSlug}-${blockUuid}`
    }
  }

  // Fallback to full UUID
  return `${baseSlug}-${blockUuid}`
}

/**
 * Extract tags from a markdown document body
 * Tags are markdown links where both the link and target start with # and are identical
 * e.g. [#mytag](#mytag) 
 * @param body The markdown document body
 * @returns Array of unique tags found in the document
 */
export function extractTagsFromMarkdown(body: string): string[] {
  // Match markdown links that are tags: [#tag](#tag)
  // This regex looks for:
  // - [ followed by # followed by non-whitespace characters (capturing group 1)
  // - ](
  // - # followed by the same characters as in capturing group 1 (using backreference \1)
  // - )
  const tagRegex = /\[#([^\s\]]+)\]\(#\1\)/g
  const tags = new Set<string>()
  let match
  
  while ((match = tagRegex.exec(body)) !== null) {
    tags.add(match[1])
  }
  
  return Array.from(tags)
}

/**
 * Options for the indexSlugs function
 */
export interface IndexSlugsOptions {
  /**
   * Maximum number of slugs to index in one call
   * Defaults to 100
   */
  limit?: number
}

/**
 * Result of the indexSlugs function
 */
export interface IndexSlugsResult {
  /**
   * Number of slugs that were indexed
   */
  indexedCount: number

  /**
   * Whether there are more slugs to index
   */
  hasMore: boolean

  /**
   * Block UUIDs that were processed during this indexing run.
   * Can be passed to indexSearchVectors to avoid a redundant scan.
   */
  indexedBlockUuids: string[]
}

/**
 * Index slugs and tags for unindexed blocks
 * 
 * This function:
 * 1. Finds unindexed blocks by comparing the block table with the indexed_block table
 * 2. Determines which blocks are authoritative (latest version)
 * 3. Extracts titles from authoritative blocks and converts them to slugs
 * 4. Extracts tags from authoritative blocks
 * 5. Updates the block_slug and block_tag index tables
 * 
 * @param localDb The TributaryLocal database instance for local operations (index tables)
 * @param options Indexing options
 * @returns Result indicating how many slugs were indexed and if there are more
 */
export async function indexSlugs(
  localDb: TributaryLocal,
  options: IndexSlugsOptions = {}
): Promise<IndexSlugsResult> {
  const limit = options.limit ?? 100

  // First, find the latest version of each block using a window function
  const unindexedBlocksResult = await localDb.query(`
    SELECT
      latest_blocks.block_uuid,
      latest_blocks.version_uuid,
      latest_blocks.body,
      latest_blocks.insert_datetime
    FROM (
      SELECT
        block_uuid,
        version_uuid,
        body,
        insert_datetime,
        ROW_NUMBER() OVER (PARTITION BY block_uuid ORDER BY insert_datetime DESC) as rn
      FROM block
    ) latest_blocks
    LEFT JOIN indexed_block ib ON latest_blocks.block_uuid = ib.block_uuid
    WHERE latest_blocks.rn = 1  -- Only latest versions
    AND (ib.block_uuid IS NULL OR latest_blocks.version_uuid != ib.version_uuid)
    ORDER BY latest_blocks.insert_datetime ASC  -- Process oldest first
    LIMIT $1
  `, [limit])

  const unindexedBlocks: UnindexedBlock[] = (unindexedBlocksResult.rows || []) as UnindexedBlock[]

  // If no unindexed blocks, return early
  if (unindexedBlocks.length === 0) {
    return {
      indexedCount: 0,
      hasMore: false,
      indexedBlockUuids: []
    }
  }

  console.log(`indexSlugs: ${unindexedBlocks.length} new/changed authoritative blocks to index`)
  const slugStartTime = performance.now()

  // Process all blocks in a single transaction for atomicity and performance
  let indexedCount = 0
  const indexedBlockUuids: string[] = []

  await localDb.transaction(async (tx: any) => {
    for (const block of unindexedBlocks) {
      const title = extractTitleFromMarkdown(block.body)
      const baseSlug = title ? titleToSlug(title) : null
      const tags = extractTagsFromMarkdown(block.body)
      const now = new Date().toISOString()

      // Mark the block as indexed
      await tx.query(
        `INSERT INTO indexed_block (block_uuid, version_uuid, indexed, last_indexed_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (block_uuid)
         DO UPDATE SET version_uuid = $2, indexed = $3, last_indexed_at = $4`,
        [block.block_uuid, block.version_uuid, true, now]
      )

      // Update the authoritative version mapping
      await tx.query(
        `INSERT INTO authoritative_version (block_uuid, version_uuid, indexed_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (block_uuid)
         DO UPDATE SET version_uuid = $2, indexed_at = $3`,
        [block.block_uuid, block.version_uuid, now]
      )

      // Handle slug updates
      if (baseSlug && title) {
        // Check if this base slug already exists for a different block
        const existingSlugResult = await tx.query(
          `SELECT block_uuid FROM block_slug WHERE slug = $1`,
          [baseSlug]
        )

        const existingSlugRow = existingSlugResult.rows && existingSlugResult.rows.length > 0 ? existingSlugResult.rows[0] as ExistingSlugResult : null
        const existingSlug = existingSlugRow ? existingSlugRow : null

        if (existingSlug && existingSlug.block_uuid !== block.block_uuid) {
          // Conflict detected - update both blocks to have UUID suffixes
          const existingBlockResult = await tx.query(
            `SELECT block_uuid, body FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
            [existingSlug.block_uuid]
          )

          const existingBlockRow = existingBlockResult.rows && existingBlockResult.rows.length > 0 ? existingBlockResult.rows[0] as ExistingBlockResult : null

          if (existingBlockRow) {
            const existingTitle = extractTitleFromMarkdown(existingBlockRow.body)
            const existingBaseSlug = existingTitle ? titleToSlug(existingTitle) : null

            if (existingBaseSlug) {
              const existingBlockSuffix = existingBlockRow.block_uuid.substring(0, 4)
              const updatedExistingSlug = `${existingBaseSlug}-${existingBlockSuffix}`

              await tx.query(
                `UPDATE block_slug SET slug = $1, title = $2, indexed_at = $3 WHERE block_uuid = $4`,
                [updatedExistingSlug, existingTitle || "Untitled", now, existingBlockRow.block_uuid]
              )
            }
          }

          const currentBlockSuffix = block.block_uuid.substring(0, 4)
          const finalSlug = `${baseSlug}-${currentBlockSuffix}`

          await tx.query(
            `INSERT INTO block_slug (block_uuid, slug, title, indexed_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (block_uuid)
             DO UPDATE SET slug = $2, title = $3, indexed_at = $4`,
            [block.block_uuid, finalSlug, title, now]
          )
        } else {
          // No conflict or updating the same block
          await tx.query(
            `INSERT INTO block_slug (block_uuid, slug, title, indexed_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (block_uuid)
             DO UPDATE SET slug = $2, title = $3, indexed_at = $4`,
            [block.block_uuid, baseSlug, title, now]
          )
        }

        indexedCount++
      } else {
        await tx.query(
          `DELETE FROM block_slug WHERE block_uuid = $1`,
          [block.block_uuid]
        )
      }

      // Handle tag updates
      await tx.query(
        `DELETE FROM block_tag WHERE block_uuid = $1`,
        [block.block_uuid]
      )

      for (const tag of tags) {
        await tx.query(
          `INSERT INTO block_tag (block_uuid, tag, indexed_at) VALUES ($1, $2, $3)`,
          [block.block_uuid, tag, now]
        )
      }

      indexedBlockUuids.push(block.block_uuid)
    }
  })

  const slugElapsed = (performance.now() - slugStartTime).toFixed(1)
  console.log(`indexSlugs: indexed ${indexedCount} slugs in ${slugElapsed}ms`)

  return {
    indexedCount,
    hasMore: unindexedBlocks.length === limit,
    indexedBlockUuids
  }
}

/**
 * Get all block slugs
 * @param db The TributaryLocal database instance
 * @returns Array of block slugs
 */
export async function getAllBlockSlugs(db: TributaryLocal) {
  const result = await db.query(`SELECT * FROM block_slug`, [])
  return result.rows || []
}

/**
 * Get block slug by block UUID
 * @param db The TributaryLocal database instance
 * @param blockUuid The block UUID
 * @returns The block slug or null if not found
 */
export async function getBlockSlugByUuid(
  db: TributaryLocal,
  blockUuid: string
) {
  const result = await db.query(
    `SELECT * FROM block_slug WHERE block_uuid = $1`,
    [blockUuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  
  return result.rows[0]
}

/**
 * Get block slug by slug
 * @param db The TributaryLocal database instance
 * @param slug The slug to search for
 * @returns The block slug or null if not found
 */
export async function getBlockBySlug(
  db: TributaryLocal,
  slug: string
) {
  const result = await db.query(
    `SELECT * FROM block_slug WHERE slug = $1`,
    [slug]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  
  return result.rows[0]
}

/**
 * Get authoritative version for a block
 * @param db The TributaryLocal database instance
 * @param blockUuid The block UUID
 * @returns The authoritative version mapping or null if not found
 */
export async function getAuthoritativeVersionByBlockUuid(
  db: TributaryLocal,
  blockUuid: string
) {
  const result = await db.query(
    `SELECT * FROM authoritative_version WHERE block_uuid = $1`,
    [blockUuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  
  return result.rows[0]
}

/**
 * Get all authoritative versions
 * @param db The TributaryLocal database instance
 * @returns Array of authoritative version mappings
 */
export async function getAllAuthoritativeVersions(db: TributaryLocal) {
  const result = await db.query(`SELECT * FROM authoritative_version`, [])
  return result.rows || []
}

/**
 * Get all tags for a block
 * @param db The TributaryLocal database instance
 * @param blockUuid The block UUID
 * @returns Array of tags for the block
 */
export async function getTagsForBlock(
  db: TributaryLocal,
  blockUuid: string
): Promise<string[]> {
  const result = await db.query(
    `SELECT tag FROM block_tag WHERE block_uuid = $1`,
    [blockUuid]
  )
  
  // Extract just the tag strings from the database rows
  return (result.rows || []).map((row: any) => row.tag)
}

/**
 * Get all blocks that have a specific tag
 * @param db The TributaryLocal database instance
 * @param tag The tag to search for
 * @returns Array of block UUIDs that have this tag
 */
export async function getBlocksByTag(
  db: TributaryLocal,
  tag: string
): Promise<string[]> {
  const result = await db.query(
    `SELECT block_uuid FROM block_tag WHERE tag = $1`,
    [tag]
  )
  
  // Extract just the block_uuid strings from the database rows
  return (result.rows || []).map((row: any) => row.block_uuid)
}

/**
 * Get all unique tags
 * @param db The TributaryLocal database instance
 * @returns Array of all unique tags
 */
export async function getAllTags(db: TributaryLocal): Promise<string[]> {
  const result = await db.query(
    `SELECT DISTINCT tag FROM block_tag`,
    []
  )
  
  // Extract just the tag strings from the database rows
  return (result.rows || []).map((row: any) => row.tag)
}

/**
 * Get all blocks with their titles and slugs
 * @param db The TributaryLocal database instance
 * @returns Array of blocks with titles and slugs, sorted by most recently edited first
 */
export async function getAllBlocksWithTitles(db: TributaryLocal): Promise<BlockSlugRow[]> {
  const result = await db.query(
    `SELECT b.block_uuid, b.version_uuid, b.body, b.insert_datetime, bs.slug, bs.title, bs.indexed_at
     FROM block b
     INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
     LEFT JOIN block_slug bs ON b.block_uuid = bs.block_uuid
     ORDER BY b.insert_datetime DESC`,
    []
  )

  return (result.rows || []) as BlockSlugRow[]
}

/**
 * Get the last edited time for a stream
 * @param db The TributaryLocal database instance
 * @returns ISO string of the most recent block edit time, or null if no blocks exist
 */
export async function getLastEditedTime(db: TributaryLocal): Promise<string | null> {
  const result = await db.query(
    `SELECT MAX(insert_datetime) as last_edited FROM block`,
    []
  )

  const row = result.rows?.[0] as LastEditedResult | undefined
  return row?.last_edited || null
}

/**
 * Index all metadata for unindexed blocks
 * 
 * This is a convenience function that calls both indexSlugs() and indexSearchVectors()
 * to ensure all indexing is performed together.
 * 
 * @param localDb The TributaryLocal database instance
 * @param options Indexing options
 * @returns Combined result from both indexing operations
 */
export async function indexAll(
  localDb: TributaryLocal,
  options: IndexSlugsOptions = {}
): Promise<IndexSlugsResult> {
  // Import search functions
  const { indexSearchVectors } = await import('./search.js')

  // First index slugs and tags
  const slugResult = await indexSlugs(localDb, options)

  // Then index search vectors only for the blocks that were just processed,
  // avoiding a redundant full-table scan to find unindexed blocks.
  const searchResult = await indexSearchVectors(localDb, {
    ...options,
    blockUuids: slugResult.indexedBlockUuids
  })

  // Return combined results
  return {
    indexedCount: Math.max(slugResult.indexedCount, searchResult.indexedCount),
    hasMore: slugResult.hasMore || searchResult.hasMore,
    indexedBlockUuids: slugResult.indexedBlockUuids
  }
}
