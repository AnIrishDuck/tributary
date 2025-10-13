import { Kysely, sql } from 'kysely'
import { Database } from './types'

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
 * - If multiple docs have same title, first 4 chars of UUID are prepended
 * - If still conflicting, continue adding UUID chunks until unique
 * - Handles titles with UUID-like fragments
 * 
 * @param baseSlug The base slug to make unique
 * @param blockUuid The UUID of the current block
 * @param db Database transaction
 * @returns A unique slug with UUID fragments appended as needed
 */
export async function generateUniqueSlug(baseSlug: string, blockUuid: string, db: Kysely<Database>): Promise<string> {
  // Find all existing blocks with the exact same base slug
  const existingBlocks = await db
    .selectFrom('block_slug')
    .select(['block_uuid'])
    .where('slug', '=', baseSlug)
    .execute()
  
  // If no conflicts, return base slug
  if (existingBlocks.length === 0) {
    return baseSlug
  }
  
  // We have conflicts, need to add UUID fragments
  // According to the spec, when there are conflicts, we need to prefix ALL blocks
  
  // First, check if the current block already has a unique slug with a prefix
  // Try with 4-character prefix first
  const prefix4 = blockUuid.substring(0, 4)
  const slugWith4CharPrefix = `${prefix4}-${baseSlug}`
  
  // Check if this conflicts with any existing slug
  const existingSlugWith4Prefix = await db
    .selectFrom('block_slug')
    .select('block_uuid')
    .where('slug', '=', slugWith4CharPrefix)
    .where('block_uuid', '!=', blockUuid)
    .executeTakeFirst()
  
  if (!existingSlugWith4Prefix) {
    return slugWith4CharPrefix
  }
  
  // If 4-char prefix still conflicts, we need to keep adding more UUID characters
  // until we get a unique slug
  let fragmentLength = 9  // 8 characters (two 4-char segments) + 1 hyphen
  
  while (fragmentLength <= blockUuid.length) {
    const prefix = blockUuid.substring(0, fragmentLength)
    const slugWithPrefix = `${prefix}-${baseSlug}`
    
    // Check if this conflicts with any existing slug
    const existingSlugWithPrefix = await db
      .selectFrom('block_slug')
      .select('block_uuid')
      .where('slug', '=', slugWithPrefix)
      .where('block_uuid', '!=', blockUuid)
      .executeTakeFirst()
    
    if (!existingSlugWithPrefix) {
      return slugWithPrefix
    }
    
    // Increase fragment length
    fragmentLength += 5  // 4 more chars + 1 hyphen
    
    // Safety check
    if (fragmentLength > blockUuid.length) {
      return `${blockUuid}-${baseSlug}`
    }
  }
  
  // Fallback to full UUID
  return `${blockUuid}-${baseSlug}`
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
}

/**
 * Index slugs for unindexed blocks
 * 
 * This function:
 * 1. Finds unindexed blocks by comparing the block table with the indexed_block table
 * 2. Determines which blocks are authoritative (latest version)
 * 3. Extracts titles from authoritative blocks and converts them to slugs
 * 4. Updates the block_slug index table
 * 
 * @param db The Kysely database instance
 * @param options Indexing options
 * @returns Result indicating how many slugs were indexed and if there are more
 */
export async function indexSlugs(
  db: Kysely<Database>,
  options: IndexSlugsOptions = {}
): Promise<IndexSlugsResult> {
  const limit = options.limit ?? 100
  
  // First, find the latest version of each block using a window function
  const latestBlockVersions = db.selectFrom('block')
    .select([
      'block_uuid',
      'version_uuid',
      'body',
      'insert_datetime',
      sql`ROW_NUMBER() OVER (PARTITION BY block_uuid ORDER BY insert_datetime DESC)`.as('rn')
    ])
    .as('latest_blocks')
  
  // Join with indexed_block to find unindexed latest versions
  const unindexedBlocks = await db
    .selectFrom(latestBlockVersions)
    .leftJoin('indexed_block as ib', 'latest_blocks.block_uuid', 'ib.block_uuid')
    .select([
      'latest_blocks.block_uuid',
      'latest_blocks.version_uuid',
      'latest_blocks.body',
      'latest_blocks.insert_datetime'
    ])
    .where('latest_blocks.rn', '=', 1) // Only latest versions
    .where((eb) => 
      eb.or([
        eb('ib.block_uuid', 'is', null), // Not indexed at all
        eb('latest_blocks.version_uuid', '!=', eb.ref('ib.version_uuid')) // Different version
      ])
    )
    .orderBy('latest_blocks.insert_datetime', 'asc') // Process oldest first
    .limit(limit)
    .execute()
  
  // If no unindexed blocks, return early
  if (unindexedBlocks.length === 0) {
    return {
      indexedCount: 0,
      hasMore: false
    }
  }
  
  // Extract titles and update indexes
  let indexedCount = 0
  
  // Process blocks one by one to handle conflicts correctly
  for (const block of unindexedBlocks) {
    // Extract title from the block body
    const title = extractTitleFromMarkdown(block.body)
    const baseSlug = title ? titleToSlug(title) : null
    
    // Start a transaction to ensure consistency
    await db.transaction().execute(async (tx) => {
      // Mark the block as indexed
      await tx
        .insertInto('indexed_block')
        .values({
          block_uuid: block.block_uuid,
          version_uuid: block.version_uuid,
          indexed: true,
          last_indexed_at: new Date().toISOString()
        })
        .onConflict(oc => oc
          .column('block_uuid')
          .doUpdateSet({
            version_uuid: block.version_uuid,
            indexed: true,
            last_indexed_at: new Date().toISOString()
          })
        )
        .execute()
      
      // Update the authoritative version mapping
      await tx
        .insertInto('authoritative_version')
        .values({
          block_uuid: block.block_uuid,
          version_uuid: block.version_uuid,
          indexed_at: new Date().toISOString()
        })
        .onConflict(oc => oc
          .column('block_uuid')
          .doUpdateSet({
            version_uuid: block.version_uuid,
            indexed_at: new Date().toISOString()
          })
        )
        .execute()
      
      // Handle slug updates
      if (baseSlug && title) {
        // Check if this base slug already exists for a different block
        const existingSlug = await tx
          .selectFrom('block_slug')
          .selectAll()
          .where('slug', '=', baseSlug)
          .executeTakeFirst()
        
        if (existingSlug && existingSlug.block_uuid !== block.block_uuid) {
          // Conflict detected - we need to update both blocks to have UUID prefixes
          
          // Get the existing block's data to update its slug
          const existingBlock = await tx
            .selectFrom('block')
            .select(['block_uuid', 'body'])
            .where('block_uuid', '=', existingSlug.block_uuid)
            .orderBy('insert_datetime', 'desc')
            .limit(1)
            .executeTakeFirst()
          
          if (existingBlock) {
            // Extract title from the existing block
            const existingTitle = extractTitleFromMarkdown(existingBlock.body)
            const existingBaseSlug = existingTitle ? titleToSlug(existingTitle) : null
            
            if (existingBaseSlug) {
              // Generate a unique slug for the existing block
              const existingBlockPrefix = existingBlock.block_uuid.substring(0, 4)
              const updatedExistingSlug = `${existingBlockPrefix}-${existingBaseSlug}`
              
              // Update the existing block's slug
              await tx
                .updateTable('block_slug')
                .set({
                  slug: updatedExistingSlug,
                  title: existingTitle,
                  indexed_at: new Date().toISOString()
                })
                .where('block_uuid', '=', existingBlock.block_uuid)
                .execute()
            }
          }
          
          // Generate a unique slug for the current block
          const currentBlockPrefix = block.block_uuid.substring(0, 4)
          const finalSlug = `${currentBlockPrefix}-${baseSlug}`
          
          // Update or insert the slug entry for this block
          await tx
            .insertInto('block_slug')
            .values({
              block_uuid: block.block_uuid,
              slug: finalSlug,
              title: title,
              indexed_at: new Date().toISOString()
            })
            .onConflict(oc => oc
              .column('block_uuid')
              .doUpdateSet({
                slug: finalSlug,
                title: title,
                indexed_at: new Date().toISOString()
              })
            )
            .execute()
        } else {
          // No conflict or updating the same block, just use the base slug
          await tx
            .insertInto('block_slug')
            .values({
              block_uuid: block.block_uuid,
              slug: baseSlug,
              title: title,
              indexed_at: new Date().toISOString()
            })
            .onConflict(oc => oc
              .column('block_uuid')
              .doUpdateSet({
                slug: baseSlug,
                title: title,
                indexed_at: new Date().toISOString()
              })
            )
            .execute()
        }
        
        indexedCount++
      } else {
        // If no slug, delete any existing slug entry for this block
        await tx
          .deleteFrom('block_slug')
          .where('block_uuid', '=', block.block_uuid)
          .execute()
      }
    })
  }
  
  return {
    indexedCount,
    // Check if we hit the limit, indicating there might be more to process
    hasMore: unindexedBlocks.length === limit
  }
}

/**
 * Get all block slugs
 * @param db The Kysely database instance
 * @returns Array of block slugs
 */
export async function getAllBlockSlugs(db: Kysely<Database>) {
  return await db
    .selectFrom('block_slug')
    .selectAll()
    .execute()
}

/**
 * Get block slug by block UUID
 * @param db The Kysely database instance
 * @param blockUuid The block UUID
 * @returns The block slug or null if not found
 */
export async function getBlockSlugByUuid(
  db: Kysely<Database>,
  blockUuid: string
) {
  return await db
    .selectFrom('block_slug')
    .selectAll()
    .where('block_uuid', '=', blockUuid)
    .executeTakeFirst()
}

/**
 * Get block slug by slug
 * @param db The Kysely database instance
 * @param slug The slug to search for
 * @returns The block slug or null if not found
 */
export async function getBlockBySlug(
  db: Kysely<Database>,
  slug: string
) {
  return await db
    .selectFrom('block_slug')
    .selectAll()
    .where('slug', '=', slug)
    .executeTakeFirst()
}

/**
 * Get authoritative version for a block
 * @param db The Kysely database instance
 * @param blockUuid The block UUID
 * @returns The authoritative version mapping or null if not found
 */
export async function getAuthoritativeVersionByBlockUuid(
  db: Kysely<Database>,
  blockUuid: string
) {
  return await db
    .selectFrom('authoritative_version')
    .selectAll()
    .where('block_uuid', '=', blockUuid)
    .executeTakeFirst()
}

/**
 * Get all authoritative versions
 * @param db The Kysely database instance
 * @returns Array of authoritative version mappings
 */
export async function getAllAuthoritativeVersions(db: Kysely<Database>) {
  return await db
    .selectFrom('authoritative_version')
    .selectAll()
    .execute()
}
