import { v4 as uuidv4 } from 'uuid'
import { TributaryStream } from 'tributary-client'
import { createCollections, getLibrary } from './collection.js'
import { createImageBlocks } from './image.js'
import { isValidSlug } from './indexing.js'
import type { Note } from './types.js'

export interface BulkCollectionEntry {
  folderPath: string
  title: string
  slug: string
  parentFolderPath: string | null
}

export interface BulkImageEntry {
  blobHash: string
  contentType: string
  fileName: string
  slug: string
  title?: string
  width?: number
  height?: number
  folderPath: string
  lastModified?: number
}

export interface BulkUploadPlan {
  collections: BulkCollectionEntry[]
  images: BulkImageEntry[]
  rootCollectionId: string | null
}

/** Validation error for a single entry in a bulk upload plan. */
export interface BulkPlanValidationError {
  /** 'image' or 'collection' */
  type: 'image' | 'collection'
  /** Index of the entry in its respective array */
  index: number
  /** Which field has the error */
  field: 'slug' | 'title'
  /** Human-readable error message */
  message: string
}

/** Result of validating a bulk upload plan. */
export interface BulkPlanValidationResult {
  valid: boolean
  errors: BulkPlanValidationError[]
}

/**
 * Validate a bulk upload plan for format issues only.
 *
 * Checks:
 * - Every image and collection has a non-empty title
 * - Every image and collection slug passes format validation
 *
 * Slug collisions (duplicates within the plan or against existing DB
 * content) are intentionally NOT checked here — collisions are warnings
 * handled by the existing slug collision system after upload.
 */
export function validateBulkUploadPlan(plan: BulkUploadPlan): BulkPlanValidationResult {
  const errors: BulkPlanValidationError[] = []

  for (let i = 0; i < plan.collections.length; i++) {
    const col = plan.collections[i]
    if (!col.title || col.title.trim() === '') {
      errors.push({ type: 'collection', index: i, field: 'title', message: 'Title is required' })
    }
    if (!isValidSlug(col.slug)) {
      errors.push({ type: 'collection', index: i, field: 'slug', message: 'Invalid slug format' })
    }
  }

  for (let i = 0; i < plan.images.length; i++) {
    const img = plan.images[i]
    if (!img.title || img.title.trim() === '') {
      errors.push({ type: 'image', index: i, field: 'title', message: 'Title is required' })
    }
    if (!isValidSlug(img.slug)) {
      errors.push({ type: 'image', index: i, field: 'slug', message: 'Invalid slug format' })
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Resolve the effective root collection ID. When rootCollectionId is null
 * (user is at the library root), look up the library's root collection so
 * sub-collections are created as children of it rather than as a second root
 * (which would violate the collection_one_root unique constraint).
 */
async function resolveRootCollectionId(
  stream: TributaryStream,
  rootCollectionId: string | null,
): Promise<string | undefined> {
  if (rootCollectionId !== null) return rootCollectionId
  const library = await getLibrary(stream.local())
  return library?.collection_uuid
}

/**
 * Create sub-collections for a bulk upload plan in a single SQL statement.
 * Collections must be sorted parents-first so that parent UUIDs are available
 * when resolving children.
 *
 * Returns a map from folderPath to the created collection's UUID.
 */
export async function ensureBulkCollections(
  stream: TributaryStream,
  plan: BulkUploadPlan,
  inserter: string,
): Promise<Map<string, string>> {
  if (plan.collections.length === 0) return new Map()

  const resolvedRootId = await resolveRootCollectionId(stream, plan.rootCollectionId)

  // Pre-assign UUIDs so child entries can reference their parent's UUID
  const collectionMap = new Map<string, string>()
  for (const entry of plan.collections) {
    collectionMap.set(entry.folderPath, uuidv4())
  }

  const items = plan.collections.map(entry => {
    const parentUuid = entry.parentFolderPath === null
      ? resolvedRootId
      : collectionMap.get(entry.parentFolderPath)

    return {
      collection_uuid: collectionMap.get(entry.folderPath),
      title: entry.title,
      slug: entry.slug,
      parent_collection_uuid: parentUuid,
      inserter,
    }
  })

  await createCollections(stream, items)

  return collectionMap
}

/**
 * Create image blocks for all images in a bulk upload plan in a single SQL statement.
 * Uses collectionMap (from ensureBulkCollections) to resolve folder paths
 * to collection UUIDs, falling back to rootCollectionId for images at the root.
 */
export async function createBulkImageBlocks(
  stream: TributaryStream,
  plan: BulkUploadPlan,
  collectionMap: Map<string, string>,
  inserter: string,
): Promise<Note[]> {
  if (plan.images.length === 0) return []

  const resolvedRootId = await resolveRootCollectionId(stream, plan.rootCollectionId)

  const items = plan.images.map(entry => {
    const collectionId = entry.folderPath === ''
      ? resolvedRootId
      : collectionMap.get(entry.folderPath)

    return {
      blobHash: entry.blobHash,
      contentType: entry.contentType,
      fileName: entry.fileName,
      slug: entry.slug,
      title: entry.title,
      width: entry.width,
      height: entry.height,
      collectionId: collectionId ?? null,
      inserter,
    }
  })

  return createImageBlocks(stream, items)
}
