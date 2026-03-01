import { TributaryLocal } from 'tributary-client'
import { CollectionSlug, NoteSlug } from './types'
import { getCollectionBySlugUnderParent } from './collection.js'
import { getNotesBySlugInCollection } from './indexing.js'

export interface ResolveResult {
  type: 'note' | 'collection'
  entity: any
  ancestors: CollectionSlug[]
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
 * For the last segment, tries note first, then collection.
 *
 * @param db The TributaryLocal database instance
 * @param segments Array of slug segments, e.g. ['cooking', 'italian', 'pasta']
 * @param libraryUuid The UUID of the library (root collection)
 * @returns The resolved entity or null if not found
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

  // Resolve the last segment: try note first, then collection
  const lastSlug = segments[segments.length - 1]

  // Try note
  const matchingNotes = await getNotesBySlugInCollection(db, lastSlug, currentCollectionId)
  if (matchingNotes.length > 0) {
    return {
      type: 'note',
      entity: matchingNotes[0],
      ancestors
    }
  }

  // Try collection
  const matchingCollection = await getCollectionBySlugUnderParent(db, lastSlug, currentParentUuid)
  if (matchingCollection) {
    return {
      type: 'collection',
      entity: matchingCollection,
      ancestors
    }
  }

  return null
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
