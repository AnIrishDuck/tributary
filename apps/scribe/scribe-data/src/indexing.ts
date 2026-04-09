import { TributaryLocal } from 'tributary-client'
import { Note, NoteSlug, BlockSlugInfo, AuthoritativeVersion, NoteTag, PGliteResult, NoteSlugRow } from './types'
import { getLibrary } from './collection.js'


// Add proper typing for the query results
interface UnindexedNote {
  block_uuid: string;
  version_uuid: string;
  body: string;
  insert_datetime: string;
}

interface LastEditedResult {
  last_edited: string | null;
}

/**
 * Strip inline markdown formatting (bold, italic, code spans, links) from text,
 * returning the plain text content.
 */
export function stripInlineMarkdown(text: string): string {
  let result = text
  result = result.replace(/(\*\*|__)(.*?)\1/g, '$2')   // **bold** / __bold__
  result = result.replace(/(\*|_)(.*?)\1/g, '$2')       // *italic* / _italic_
  result = result.replace(/`[^`]+`/g, '')                // `code`
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url)
  return result.trim()
}

/**
 * Extract the title from a markdown document body
 * The title is the first H1 heading (# Title) in the document.
 * Inline formatting (bold, italic, code, links) is stripped from the title.
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
    return stripInlineMarkdown(match[1])
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
 * Convert a slug back to a human-readable title.
 * Splits on hyphens and capitalises the first letter of each word.
 * @param slug The slug to convert, e.g. "my-recipe"
 * @returns The title version of the slug, e.g. "My Recipe"
 */
export function slugToTitle(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Try to extract a display title from an image block's JSON body.
 * Returns title, altText, or fileName if present, otherwise null.
 */
export function tryParseImageTitle(body: string): string | null {
  try {
    const parsed = JSON.parse(body)
    return parsed.title || parsed.altText || parsed.fileName || null
  } catch {
    return null
  }
}

/**
 * Extract a display title from a block, dispatching by block type.
 * For markdown blocks, extracts the first H1 heading.
 * For image blocks, parses the JSON body for title/altText/fileName.
 *
 * @param body The block body content
 * @param blockType The block type (defaults to 'scribe/markdown')
 * @returns The extracted title, or empty string if none found
 */
export function extractBlockTitle(body: string, blockType?: string | null): string {
  const resolved = blockType || 'scribe/markdown'
  if (resolved === 'scribe/image') {
    return tryParseImageTitle(body) || ''
  }
  return extractTitleFromMarkdown(body) || ''
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
   * Note UUIDs that were processed during this indexing run.
   * Can be passed to indexSearchVectors to avoid a redundant scan.
   */
  indexedBlockUuids: string[]
}

/**
 * Index metadata for unindexed notes
 *
 * This function:
 * 1. Finds unindexed notes by comparing the block table with the indexed_block table
 * 2. Determines which notes are authoritative (latest version)
 * 3. Extracts tags from authoritative notes
 * 4. Updates the indexed_block, authoritative_version, and block_tag tables
 *
 * @param localDb The TributaryLocal database instance for local operations (index tables)
 * @param options Indexing options
 * @returns Result indicating how many notes were indexed and if there are more
 */
export async function indexSlugs(
  localDb: TributaryLocal,
  options: IndexSlugsOptions = {}
): Promise<IndexSlugsResult> {
  const limit = options.limit ?? 100

  // First, find the latest version of each note using a window function
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

  const unindexedNotes: UnindexedNote[] = (unindexedBlocksResult.rows || []) as UnindexedNote[]

  // If no unindexed notes, return early
  if (unindexedNotes.length === 0) {
    return {
      indexedCount: 0,
      hasMore: false,
      indexedBlockUuids: []
    }
  }

  console.log(`indexSlugs: ${unindexedNotes.length} new/changed authoritative notes to index`)

  // Phase 1: CPU-only work — extract tags from markdown.
  const cpuStart = performance.now()
  const now = new Date().toISOString()

  interface ProcessedNote {
    block_uuid: string
    version_uuid: string
    tags: string[]
  }

  const processed: ProcessedNote[] = unindexedNotes.map(note => ({
    block_uuid: note.block_uuid,
    version_uuid: note.version_uuid,
    tags: extractTagsFromMarkdown(note.body)
  }))

  const allTags: { block_uuid: string, tag: string }[] = []
  for (const n of processed) {
    for (const tag of n.tags) {
      allTags.push({ block_uuid: n.block_uuid, tag })
    }
  }

  const indexedBlockUuids = processed.map(n => n.block_uuid)
  const indexedCount = processed.length
  const cpuMs = Math.round(performance.now() - cpuStart)

  // Phase 2: Batch DB writes — a small constant number of multi-row queries
  // instead of ~5N + M individual round-trips through PGliteWorker.
  const dbStart = performance.now()

  await localDb.transaction(async (tx: any) => {
    // Batch upsert indexed_block (N rows, 1 query)
    {
      const vals = processed.map((_, i) => {
        const b = i * 4
        return `($${b+1}, $${b+2}, $${b+3}, $${b+4})`
      }).join(', ')
      const params = processed.flatMap(n => [n.block_uuid, n.version_uuid, true, now])
      await tx.query(
        `INSERT INTO indexed_block (block_uuid, version_uuid, indexed, last_indexed_at)
         VALUES ${vals}
         ON CONFLICT (block_uuid)
         DO UPDATE SET version_uuid = EXCLUDED.version_uuid, indexed = EXCLUDED.indexed, last_indexed_at = EXCLUDED.last_indexed_at`,
        params
      )
    }

    // Batch upsert authoritative_version (N rows, 1 query)
    {
      const vals = processed.map((_, i) => {
        const b = i * 3
        return `($${b+1}, $${b+2}, $${b+3})`
      }).join(', ')
      const params = processed.flatMap(n => [n.block_uuid, n.version_uuid, now])
      await tx.query(
        `INSERT INTO authoritative_version (block_uuid, version_uuid, indexed_at)
         VALUES ${vals}
         ON CONFLICT (block_uuid)
         DO UPDATE SET version_uuid = EXCLUDED.version_uuid, indexed_at = EXCLUDED.indexed_at`,
        params
      )
    }

    // Delete all old tags for processed notes in one shot, then bulk-insert new ones
    {
      const placeholders = processed.map((_, i) => `$${i+1}`).join(', ')
      await tx.query(
        `DELETE FROM block_tag WHERE block_uuid IN (${placeholders})`,
        processed.map(n => n.block_uuid)
      )
    }

    if (allTags.length > 0) {
      const vals = allTags.map((_, i) => {
        const b = i * 3
        return `($${b+1}, $${b+2}, $${b+3})`
      }).join(', ')
      const params = allTags.flatMap(t => [t.block_uuid, t.tag, now])
      await tx.query(
        `INSERT INTO block_tag (block_uuid, tag, indexed_at) VALUES ${vals}`,
        params
      )
    }
  })

  const dbMs = Math.round(performance.now() - dbStart)
  console.log(`indexSlugs: indexed ${indexedCount} notes (cpu ${cpuMs}ms, db ${dbMs}ms)`)

  return {
    indexedCount,
    hasMore: unindexedNotes.length === limit,
    indexedBlockUuids
  }
}

/**
 * Get note slug by note UUID.
 * Queries the authoritative version of the block for its slug and extracts
 * the title from the body.
 *
 * @param db The TributaryLocal database instance
 * @param noteUuid The note UUID
 * @returns The note slug or null if not found
 */
export async function getNoteSlugByUuid(
  db: TributaryLocal,
  noteUuid: string
): Promise<BlockSlugInfo | null> {
  const result = await db.query(
    `SELECT b.block_uuid, b.slug, b.body, b.block_type
     FROM block b
     INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
     WHERE b.block_uuid = $1`,
    [noteUuid]
  )

  if (!result.rows || result.rows.length === 0) {
    return null
  }

  const row = result.rows[0] as any
  const blockType = row.block_type || 'scribe/markdown'
  return {
    block_uuid: row.block_uuid,
    slug: row.slug,
    title: extractBlockTitle(row.body, blockType),
    block_type: blockType
  }
}

/**
 * Get all notes matching a slug.
 * Queries the synced block table via authoritative version.
 *
 * @param db The TributaryLocal database instance
 * @param slug The slug to search for
 * @returns Array of matching note slugs, or empty array if none found
 */
export async function getNotesBySlug(
  db: TributaryLocal,
  slug: string
): Promise<NoteSlug[]> {
  const result = await db.query(
    `SELECT b.block_uuid, b.slug, b.body
     FROM block b
     INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
     WHERE b.slug = $1`,
    [slug]
  )

  return (result.rows || []).map((row: any) => ({
    block_uuid: row.block_uuid,
    slug: row.slug,
    title: extractTitleFromMarkdown(row.body) || ''
  }))
}

/**
 * Get note slug by slug (returns first match for backwards compatibility)
 * @param db The TributaryLocal database instance
 * @param slug The slug to search for
 * @returns The first matching note slug or null if not found
 */
export async function getNoteBySlug(
  db: TributaryLocal,
  slug: string
) {
  const results = await getNotesBySlug(db, slug)
  return results.length > 0 ? results[0] : null
}

/**
 * Get authoritative version for a note
 * @param db The TributaryLocal database instance
 * @param noteUuid The note UUID
 * @returns The authoritative version mapping or null if not found
 */
export async function getAuthoritativeVersionByNoteUuid(
  db: TributaryLocal,
  noteUuid: string
) {
  const result = await db.query(
    `SELECT * FROM authoritative_version WHERE block_uuid = $1`,
    [noteUuid]
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
 * Get all tags for a note
 * @param db The TributaryLocal database instance
 * @param noteUuid The note UUID
 * @returns Array of tags for the note
 */
export async function getTagsForNote(
  db: TributaryLocal,
  noteUuid: string
): Promise<string[]> {
  const result = await db.query(
    `SELECT tag FROM block_tag WHERE block_uuid = $1`,
    [noteUuid]
  )
  
  // Extract just the tag strings from the database rows
  return (result.rows || []).map((row: any) => row.tag)
}

/**
 * Get all notes that have a specific tag
 * @param db The TributaryLocal database instance
 * @param tag The tag to search for
 * @returns Array of note UUIDs that have this tag
 */
export async function getNotesByTag(
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
 * Get all notes with their titles and slugs.
 * Uses the synced block.slug column and extracts titles from the body.
 *
 * @param db The TributaryLocal database instance
 * @returns Array of notes with titles and slugs, sorted by most recently edited first
 */
export async function getAllNotesWithTitles(db: TributaryLocal): Promise<NoteSlugRow[]> {
  const result = await db.query(
    `SELECT b.block_uuid, b.slug, b.body, b.insert_datetime, b.collection_id, b.block_type
     FROM block b
     INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
     ORDER BY b.insert_datetime DESC`,
    []
  )

  return (result.rows || []).map((row: any) => {
    const blockType = row.block_type || 'scribe/markdown'
    return {
      block_uuid: row.block_uuid,
      slug: row.slug,
      title: extractBlockTitle(row.body, blockType),
      insert_datetime: row.insert_datetime,
      collection_id: row.collection_id,
      block_type: blockType
    }
  })
}

/**
 * Get notes in a specific collection with their slugs.
 * Pass null for collectionId to get notes not in any collection (library-root notes).
 * Uses the synced block.slug column and extracts titles from the body.
 *
 * @param db The TributaryLocal database instance
 * @param collectionId The collection UUID, or null for library-root notes
 * @returns Array of notes with titles and slugs, sorted by most recently edited first
 */
export async function getNotesInCollectionWithSlugs(
  db: TributaryLocal,
  collectionId: string | null
): Promise<NoteSlugRow[]> {
  let resolvedId = collectionId
  if (resolvedId === null) {
    const library = await getLibrary(db)
    if (library) {
      resolvedId = library.collection_uuid
    }
  }

  let result
  if (resolvedId === null) {
    result = await db.query(
      `SELECT b.block_uuid, b.slug, b.body, b.insert_datetime, b.collection_id, b.block_type
       FROM block b
       INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
       WHERE b.collection_id IS NULL
       ORDER BY b.insert_datetime DESC`,
      []
    )
  } else {
    result = await db.query(
      `SELECT b.block_uuid, b.slug, b.body, b.insert_datetime, b.collection_id, b.block_type
       FROM block b
       INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
       WHERE b.collection_id = $1
       ORDER BY b.insert_datetime DESC`,
      [resolvedId]
    )
  }

  return (result.rows || []).map((row: any) => {
    const blockType = row.block_type || 'scribe/markdown'
    return {
      block_uuid: row.block_uuid,
      slug: row.slug,
      title: extractBlockTitle(row.body, blockType),
      insert_datetime: row.insert_datetime,
      collection_id: row.collection_id,
      block_type: blockType
    }
  })
}

/**
 * Fully rebuild the slug_collision table.
 * Detects collisions across both entity types (notes and collections share
 * a single slug namespace within each parent). The table is small and
 * derived, so a full DELETE + INSERT is cheap.
 *
 * @param db The TributaryLocal database instance
 */
export async function rebuildSlugCollisions(db: TributaryLocal): Promise<void> {
  await db.query(`DELETE FROM slug_collision`, [])

  await db.query(`
    WITH all_slugs AS (
      SELECT b.slug, b.collection_id AS parent_id
      FROM block b
      INNER JOIN authoritative_version av
        ON b.block_uuid = av.block_uuid
        AND b.version_uuid = av.version_uuid
      WHERE b.collection_id IS NOT NULL
      UNION ALL
      SELECT c.slug, c.parent_collection_uuid AS parent_id
      FROM collection c
      WHERE c.parent_collection_uuid IS NOT NULL
    )
    INSERT INTO slug_collision (slug, parent_id)
    SELECT slug, parent_id FROM all_slugs
    GROUP BY slug, parent_id
    HAVING COUNT(*) > 1
  `, [])
}

/**
 * Get slugs that have collisions within a given parent collection.
 * Returns a Set<string> for O(1) per-item collision checks in listing pages.
 *
 * @param db The TributaryLocal database instance
 * @param parentId The parent collection UUID
 * @returns Set of slugs that collide within this parent
 */
export async function getCollidingSlugs(
  db: TributaryLocal,
  parentId: string
): Promise<Set<string>> {
  const result = await db.query(
    `SELECT slug FROM slug_collision WHERE parent_id = $1`,
    [parentId]
  )
  return new Set((result.rows || []).map((row: any) => row.slug))
}

/**
 * Get notes matching a slug scoped to a specific collection.
 * Pass null for collectionId to get notes at the library root (collection_id IS NULL).
 * Queries the synced block table directly via authoritative version.
 *
 * @param db The TributaryLocal database instance
 * @param slug The slug to search for
 * @param collectionId The collection UUID, or null for root-level notes
 * @returns Array of matching note slugs
 */
export async function getNotesBySlugInCollection(
  db: TributaryLocal,
  slug: string,
  collectionId: string | null
): Promise<BlockSlugInfo[]> {
  let resolvedId = collectionId
  if (resolvedId === null) {
    const library = await getLibrary(db)
    if (library) {
      resolvedId = library.collection_uuid
    }
  }

  let result
  if (resolvedId === null) {
    result = await db.query(
      `SELECT b.block_uuid, b.slug, b.body, b.block_type
       FROM block b
       INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
       WHERE b.slug = $1 AND b.collection_id IS NULL`,
      [slug]
    )
  } else {
    result = await db.query(
      `SELECT b.block_uuid, b.slug, b.body, b.block_type
       FROM block b
       INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
       WHERE b.slug = $1 AND b.collection_id = $2`,
      [slug, resolvedId]
    )
  }

  return (result.rows || []).map((row: any) => ({
    block_uuid: row.block_uuid,
    slug: row.slug,
    title: extractBlockTitle(row.body, row.block_type),
    block_type: row.block_type || 'scribe/markdown',
  }))
}

/**
 * Get the last edited time for a library
 * @param db The TributaryLocal database instance
 * @returns ISO string of the most recent note edit time, or null if no notes exist
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
 * Index all metadata for unindexed notes
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

  // First index note metadata (authoritative versions and tags)
  const slugResult = await indexSlugs(localDb, options)

  // Rebuild slug collision cache (cheap — few rows)
  await rebuildSlugCollisions(localDb)

  // Rebuild the title index for wikilink resolution (cheap — few rows)
  const { rebuildTitleIndex } = await import('./titleIndex.js')
  await rebuildTitleIndex(localDb)

  // Then index search vectors only for the notes that were just processed,
  // avoiding a redundant full-table scan to find unindexed notes.
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

export interface LibraryStats {
  editCount: number
  noteCount: number
  collectionCount: number
}

/**
 * Get summary statistics for a library: total edits (block rows),
 * distinct notes, and named collections.
 *
 * @param db The TributaryLocal database instance
 * @returns Counts of edits, notes, and collections
 */
export async function getLibraryStats(db: TributaryLocal): Promise<LibraryStats> {
  const result = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM block) AS edit_count,
       (SELECT COUNT(DISTINCT block_uuid)::int FROM block) AS note_count,
       (SELECT COUNT(*)::int FROM collection WHERE parent_collection_uuid IS NOT NULL) AS collection_count`,
    []
  )

  const row = result.rows?.[0] as any
  return {
    editCount: row?.edit_count ?? 0,
    noteCount: row?.note_count ?? 0,
    collectionCount: row?.collection_count ?? 0,
  }
}
