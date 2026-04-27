import { TributaryLocal } from 'tributary-client'
import { extractTitleFromMarkdown } from './indexing.js'

/**
 * Try to extract the title from an image block's JSON body.
 * Only uses the explicit title field — altText and fileName are display
 * fallbacks used elsewhere but not indexed for wikilink resolution.
 */
function tryParseImageTitle(body: string): string | null {
  try {
    const parsed = JSON.parse(body)
    return parsed.title || null
  } catch {
    return null
  }
}

/**
 * Result of a title lookup in the title index.
 */
export interface TitleLookupResult {
  title: string
  entity_type: string
  entity_uuid: string
  slug_path: string
}

/**
 * Rebuild the title_index table from scratch.
 *
 * Queries all authoritative notes and all named collections, computes their
 * full slug paths, and populates the title_index table. This is a full
 * DELETE + INSERT rebuild (same pattern as rebuildSlugCollisions).
 *
 * The title index is flat across the entire library — two notes with the
 * same title in different collections both map to the same title key.
 *
 * @param db The TributaryLocal database instance
 */
export async function rebuildTitleIndex(db: TributaryLocal): Promise<void> {
  // Phase 1: Load all collections into memory and build a parent→slug map
  // so we can compute slug paths without N+1 queries.
  const collectionsResult = await db.query(
    `SELECT collection_uuid, title, slug, parent_collection_uuid
     FROM collection`,
    []
  )
  const collections = (collectionsResult.rows || []) as Array<{
    collection_uuid: string
    title: string
    slug: string
    parent_collection_uuid: string | null
  }>

  // Build a lookup map: uuid → collection row
  const collectionMap = new Map<string, typeof collections[0]>()
  for (const c of collections) {
    collectionMap.set(c.collection_uuid, c)
  }

  // Compute slug path for a collection (excluding root).
  // Returns segments like ['cooking', 'italian'].
  function collectionSlugPath(uuid: string): string[] {
    const segments: string[] = []
    let current = collectionMap.get(uuid)
    while (current && current.parent_collection_uuid !== null) {
      segments.unshift(current.slug)
      current = collectionMap.get(current.parent_collection_uuid!)
    }
    return segments
  }

  // Phase 2: Gather all entries for the title index
  const entries: Array<{ title: string; entity_type: string; entity_uuid: string; slug_path: string }> = []

  // 2a: Authoritative blocks (notes and images) with titles
  const blocksResult = await db.query<{ block_uuid: string; slug: string; body: string; collection_id: string | null; block_type: string }>(
    `SELECT b.block_uuid, b.slug, b.body, b.collection_id, b.block_type
     FROM block b
     INNER JOIN authoritative_version av
       ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid`,
    []
  )

  for (const row of blocksResult.rows || []) {
    const blockType = row.block_type || 'scribe/markdown'
    let title: string | null
    if (blockType === 'scribe/image') {
      title = tryParseImageTitle(row.body)
    } else {
      title = extractTitleFromMarkdown(row.body)
    }
    if (!title) continue

    const collectionPath = row.collection_id
      ? collectionSlugPath(row.collection_id)
      : []
    const slugPath = [...collectionPath, row.slug].join('/')

    entries.push({
      title,
      entity_type: blockType === 'scribe/image' ? 'image' : 'note',
      entity_uuid: row.block_uuid,
      slug_path: slugPath
    })
  }

  // 2b: Named collections (exclude root which has parent_collection_uuid === null)
  for (const c of collections) {
    if (c.parent_collection_uuid === null) continue

    const slugPath = collectionSlugPath(c.collection_uuid).join('/')
    entries.push({
      title: c.title,
      entity_type: 'collection',
      entity_uuid: c.collection_uuid,
      slug_path: slugPath
    })
  }

  // Phase 3: Write to DB
  await db.query(`DELETE FROM title_index`, [])

  if (entries.length === 0) return

  const vals = entries.map((_, i) => {
    const b = i * 5
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`
  }).join(', ')
  const params = entries.flatMap(e => [
    e.title,
    e.title.toLowerCase(),
    e.entity_type,
    e.entity_uuid,
    e.slug_path
  ])

  await db.query(
    `INSERT INTO title_index (title, title_lower, entity_type, entity_uuid, slug_path)
     VALUES ${vals}`,
    params
  )
}

/**
 * Look up entities by title (case-insensitive).
 *
 * Returns all notes and collections whose title matches, regardless of
 * which collection they are in (flat across the library).
 *
 * @param db The TributaryLocal database instance
 * @param title The title to search for
 * @returns Array of matching entities
 */
export async function lookupByTitle(
  db: TributaryLocal,
  title: string
): Promise<TitleLookupResult[]> {
  const result = await db.query(
    `SELECT title, entity_type, entity_uuid, slug_path
     FROM title_index
     WHERE title_lower = $1`,
    [title.toLowerCase()]
  )

  return (result.rows || []) as TitleLookupResult[]
}

/**
 * Options for `suggestByTitlePrefix`.
 */
export interface SuggestByTitlePrefixOptions {
  /** Maximum number of suggestions to return. Defaults to 5. */
  limit?: number
}

/**
 * Suggest entities whose title starts with the given prefix (case-insensitive).
 *
 * This is the wikilink counterpart to `suggestSlugs` — it searches the
 * title_index for titles matching a prefix, for typeahead/autocomplete
 * inside `[[ ]]` wikilinks.
 *
 * @param db The TributaryLocal database instance
 * @param prefix The title prefix to search for
 * @param options Limit options
 * @returns Array of matching entities, up to `limit`
 */
export async function suggestByTitlePrefix(
  db: TributaryLocal,
  prefix: string,
  options: SuggestByTitlePrefixOptions = {}
): Promise<TitleLookupResult[]> {
  const limit = options.limit ?? 5

  const result = await db.query(
    `SELECT title, entity_type, entity_uuid, slug_path
     FROM title_index
     WHERE title_lower LIKE $1
     ORDER BY title_lower
     LIMIT $2`,
    [prefix.toLowerCase() + '%', limit]
  )

  return (result.rows || []) as TitleLookupResult[]
}
