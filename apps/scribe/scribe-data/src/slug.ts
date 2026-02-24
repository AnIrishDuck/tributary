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
  let currentCollectionId: string | null = null // for note lookup: null = root
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
