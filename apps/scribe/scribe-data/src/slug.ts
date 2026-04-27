import { TributaryLocal } from 'tributary-client'
import { CollectionSlug, NoteSlug, BlockSlugInfo } from './types'
import { getCollectionBySlugUnderParent } from './collection.js'
import { getNotesBySlugInCollection, extractBlockTitle } from './indexing.js'

export interface ResolveResult {
  type: 'note' | 'collection' | 'collision' | 'image'
  entity: any
  ancestors: CollectionSlug[]
  /** Present when type is 'collision': the matching notes, images, and collections. */
  collisions?: { notes: BlockSlugInfo[]; collections: CollectionSlug[] }
}

/**
 * Result of a partial slug resolution.
 *
 * When a full slug path cannot be resolved, this tells the caller exactly
 * which segments were resolved and which are missing.
 */
export interface PartialResolveResult {
  /**
   * Segments that resolved successfully as ancestor collections.
   * These are in order from root to the deepest resolved collection.
   */
  resolvedSegments: string[]

  /**
   * The CollectionSlug records for each resolved ancestor segment.
   */
  resolvedCollections: CollectionSlug[]

  /**
   * Segments that could not be resolved (the missing part of the path).
   * The first element is the segment where resolution failed.
   */
  missingSegments: string[]

  /**
   * Whether the immediate parent of the target slug exists.
   * If true, the user can create a note or collection at this path.
   * If false, parent collections need to be created first.
   */
  parentExists: boolean

  /**
   * The UUID of the deepest resolved parent collection, or the library UUID
   * if no segments were resolved. Useful for creating new entities.
   */
  parentUuid: string
}

/**
 * Walk a slug path left-to-right to resolve the final entity.
 *
 * For each segment except the last, resolves as a collection under the current parent.
 * For the last segment, looks up both notes and collections. If there is exactly one
 * match it is returned as 'note' or 'collection'. If multiple entities share the slug
 * (two notes, or a note and a collection), returns type 'collision' with all matches.
 *
 * @param db The TributaryLocal database instance
 * @param segments Array of slug segments, e.g. ['cooking', 'italian', 'pasta']
 * @param libraryUuid The UUID of the library (root collection)
 * @returns The resolved entity, a collision descriptor, or null if not found
 */
export async function resolveSlugPath(
  db: TributaryLocal,
  segments: string[],
  libraryUuid: string
): Promise<ResolveResult | null> {
  if (segments.length === 0) {
    return null
  }

  let currentParentUuid = libraryUuid
  let currentCollectionId: string | null = libraryUuid // for note lookup: library root
  const ancestors: CollectionSlug[] = []

  // Walk all segments except the last as collections
  for (let i = 0; i < segments.length - 1; i++) {
    const slug = segments[i]
    const collection = await getCollectionBySlugUnderParent(db, slug, currentParentUuid)

    if (!collection) {
      return null
    }

    ancestors.push(collection)
    currentParentUuid = collection.collection_uuid
    currentCollectionId = collection.collection_uuid
  }

  // Resolve the last segment: look up both notes/images and collections
  const lastSlug = segments[segments.length - 1]

  const matchingBlocks = await getNotesBySlugInCollection(db, lastSlug, currentCollectionId)
  const matchingCollection = await getCollectionBySlugUnderParent(db, lastSlug, currentParentUuid)

  const matchingCollections: CollectionSlug[] = matchingCollection ? [matchingCollection] : []
  const totalMatches = matchingBlocks.length + matchingCollections.length

  if (totalMatches === 0) {
    return null
  }

  // Collision: multiple blocks, or a block and a collection share the slug
  if (totalMatches > 1) {
    return {
      type: 'collision',
      entity: null,
      ancestors,
      collisions: { notes: matchingBlocks, collections: matchingCollections }
    }
  }

  // Exactly one match
  if (matchingBlocks.length === 1) {
    const block = matchingBlocks[0]
    const isImage = block.block_type === 'scribe/image'
    return {
      type: isImage ? 'image' : 'note',
      entity: block,
      ancestors
    }
  }

  return {
    type: 'collection',
    entity: matchingCollection,
    ancestors
  }
}

/**
 * Walk a slug path left-to-right and return partial resolution info.
 *
 * Unlike `resolveSlugPath` which returns null on failure, this function
 * always returns a result describing how far resolution got. This is used
 * to distinguish between:
 *
 * - **Missing slug with existing parent**: the user can create a note or
 *   collection at this path (only the final segment is unresolved).
 * - **Missing parent collections**: one or more intermediate collections
 *   need to be created before the target path can exist.
 *
 * @param db The TributaryLocal database instance
 * @param segments Array of slug segments, e.g. ['cooking', 'italian', 'pasta']
 * @param libraryUuid The UUID of the library (root collection)
 * @returns Partial resolution info
 */
export async function resolveSlugPathPartial(
  db: TributaryLocal,
  segments: string[],
  libraryUuid: string
): Promise<PartialResolveResult> {
  const resolvedSegments: string[] = []
  const resolvedCollections: CollectionSlug[] = []
  let currentParentUuid = libraryUuid

  for (let i = 0; i < segments.length; i++) {
    const slug = segments[i]
    const collection = await getCollectionBySlugUnderParent(db, slug, currentParentUuid)

    if (!collection) {
      // Resolution failed at segment i
      const missingSegments = segments.slice(i)
      return {
        resolvedSegments,
        resolvedCollections,
        missingSegments,
        parentExists: missingSegments.length === 1,
        parentUuid: currentParentUuid
      }
    }

    resolvedSegments.push(slug)
    resolvedCollections.push(collection)
    currentParentUuid = collection.collection_uuid
  }

  // All segments resolved as collections — the path exists.
  // This shouldn't normally be called for paths that exist, but handle it.
  return {
    resolvedSegments,
    resolvedCollections,
    missingSegments: [],
    parentExists: true,
    parentUuid: currentParentUuid
  }
}

/**
 * A single slug suggestion returned by `suggestSlugs`.
 */
export interface SlugSuggestion {
  /** The full slug path, e.g. 'cooking/italian/pasta' */
  slug_path: string
  /** The display title of the entity */
  title: string
  /** Whether this is a 'note', 'image', or 'collection' */
  type: 'note' | 'image' | 'collection'
}

/**
 * Options for `suggestSlugs`.
 */
export interface SuggestSlugsOptions {
  /** Maximum number of suggestions to return. Defaults to 5. */
  limit?: number
  /** Filter to only notes, images, or collections. Defaults to undefined (all). */
  slug_type?: 'note' | 'image' | 'collection'
}

/**
 * Suggest slugs matching a prefix, for typeahead/autocomplete.
 *
 * All segments except the last are resolved as collections (via
 * `resolveSlugPathPartial`) to find the parent scope. The final segment is
 * used as a prefix filter on slugs within that parent collection.
 *
 * For example, given segments ['cooking', 'ital']:
 * 1. Resolve 'cooking' as a collection under the library root.
 * 2. Find all notes and collections under 'cooking' whose slug starts with 'ital'.
 *
 * @param db The TributaryLocal database instance
 * @param segments Array of slug segments, e.g. ['cooking', 'ital']
 * @param libraryUuid The UUID of the library (root collection)
 * @param options Limit and type filter options
 * @returns Array of matching slug suggestions, up to `limit`
 */
export async function suggestSlugs(
  db: TributaryLocal,
  segments: string[],
  libraryUuid: string,
  options: SuggestSlugsOptions = {}
): Promise<SlugSuggestion[]> {
  const limit = options.limit ?? 5
  const slugType = options.slug_type

  // The last segment is the prefix to match against; all prior segments
  // are parent collections to resolve.
  const parentSegments = segments.slice(0, -1)
  const searchPrefix = segments.length > 0 ? segments[segments.length - 1] : ''

  // Resolve parent path using existing partial resolution
  const partial = await resolveSlugPathPartial(db, parentSegments, libraryUuid)
  if (partial.missingSegments.length > 0) {
    // Parent path doesn't fully exist — no suggestions
    return []
  }

  const parentUuid = partial.parentUuid
  const pathPrefix = partial.resolvedSegments.length > 0
    ? partial.resolvedSegments.join('/') + '/'
    : ''
  const suggestions: SlugSuggestion[] = []

  // Query matching collections
  if (slugType !== 'note') {
    const likePattern = searchPrefix + '%'
    const collResult = await db.query(
      `SELECT collection_uuid, slug, title, parent_collection_uuid
       FROM collection
       WHERE parent_collection_uuid = $1 AND slug LIKE $2
       ORDER BY slug
       LIMIT $3`,
      [parentUuid, likePattern, limit]
    )

    for (const row of (collResult.rows || []) as CollectionSlug[]) {
      suggestions.push({
        slug_path: pathPrefix + row.slug,
        title: row.title,
        type: 'collection'
      })
    }
  }

  // Query matching notes
  if (slugType !== 'collection') {
    const remaining = limit - suggestions.length
    if (remaining > 0) {
      const likePattern = searchPrefix + '%'
      const noteResult = await db.query<{ block_uuid: string; slug: string; body: string; block_type: string }>(
        `SELECT b.block_uuid, b.slug, b.body, b.block_type
         FROM block b
         INNER JOIN authoritative_version av
           ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
         WHERE b.collection_id = $1 AND b.slug LIKE $2
         ORDER BY b.slug
         LIMIT $3`,
        [parentUuid, likePattern, remaining]
      )

      for (const row of noteResult.rows || []) {
        suggestions.push({
          slug_path: pathPrefix + row.slug,
          title: extractBlockTitle(row.body, row.block_type),
          type: row.block_type === 'scribe/image' ? 'image' : 'note'
        })
      }
    }
  }

  // Sort by slug_path and enforce overall limit
  suggestions.sort((a, b) => a.slug_path.localeCompare(b.slug_path))
  return suggestions.slice(0, limit)
}
