import { v4 as uuidv4 } from 'uuid'
import { TributaryStream } from 'tributary-client'
import { createCollections, getLibrary } from './collection.js'
import { createImageBlocks } from './image.js'
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

const VALID_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Check whether a string is a valid slug (lowercase alphanumeric with single hyphens). */
export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && VALID_SLUG_RE.test(slug)
}

/**
 * Validate a bulk upload plan for slug format issues and conflicts.
 *
 * Checks:
 * - Every image and collection has a non-empty title
 * - Every image and collection slug passes format validation
 * - No two images in the same folder share a slug
 * - No two collections with the same parent share a slug
 * - No image slug conflicts with a collection slug in the same scope
 */
export function validateBulkUploadPlan(plan: BulkUploadPlan): BulkPlanValidationResult {
  const errors: BulkPlanValidationError[] = []

  // Validate collection entries
  for (let i = 0; i < plan.collections.length; i++) {
    const col = plan.collections[i]
    if (!col.title || col.title.trim() === '') {
      errors.push({ type: 'collection', index: i, field: 'title', message: 'Title is required' })
    }
    if (!isValidSlug(col.slug)) {
      errors.push({ type: 'collection', index: i, field: 'slug', message: 'Invalid slug format' })
    }
  }

  // Validate image entries
  for (let i = 0; i < plan.images.length; i++) {
    const img = plan.images[i]
    if (!img.title || img.title.trim() === '') {
      errors.push({ type: 'image', index: i, field: 'title', message: 'Title is required' })
    }
    if (!isValidSlug(img.slug)) {
      errors.push({ type: 'image', index: i, field: 'slug', message: 'Invalid slug format' })
    }
  }

  // Check for duplicate image slugs within the same folder
  const imageSlugsPerFolder = new Map<string, Map<string, number[]>>()
  for (let i = 0; i < plan.images.length; i++) {
    const img = plan.images[i]
    if (!imageSlugsPerFolder.has(img.folderPath)) {
      imageSlugsPerFolder.set(img.folderPath, new Map())
    }
    const folderMap = imageSlugsPerFolder.get(img.folderPath)!
    if (!folderMap.has(img.slug)) {
      folderMap.set(img.slug, [])
    }
    folderMap.get(img.slug)!.push(i)
  }

  for (const [, folderMap] of imageSlugsPerFolder) {
    for (const [slug, indices] of folderMap) {
      if (indices.length > 1) {
        for (const idx of indices) {
          errors.push({
            type: 'image',
            index: idx,
            field: 'slug',
            message: `Duplicate slug "${slug}" in the same folder`,
          })
        }
      }
    }
  }

  // Check for duplicate collection slugs under the same parent
  const collSlugsPerParent = new Map<string, Map<string, number[]>>()
  for (let i = 0; i < plan.collections.length; i++) {
    const col = plan.collections[i]
    const parentKey = col.parentFolderPath ?? ''
    if (!collSlugsPerParent.has(parentKey)) {
      collSlugsPerParent.set(parentKey, new Map())
    }
    const parentMap = collSlugsPerParent.get(parentKey)!
    if (!parentMap.has(col.slug)) {
      parentMap.set(col.slug, [])
    }
    parentMap.get(col.slug)!.push(i)
  }

  for (const [, parentMap] of collSlugsPerParent) {
    for (const [slug, indices] of parentMap) {
      if (indices.length > 1) {
        for (const idx of indices) {
          errors.push({
            type: 'collection',
            index: idx,
            field: 'slug',
            message: `Duplicate collection slug "${slug}" under the same parent`,
          })
        }
      }
    }
  }

  // Check for image/collection slug conflicts in same scope
  // An image at folderPath="" with slug "x" conflicts with a collection
  // whose parentFolderPath is null and slug is "x" (both at root level).
  // An image at folderPath="a" conflicts with a collection whose parentFolderPath="a".
  for (let i = 0; i < plan.images.length; i++) {
    const img = plan.images[i]
    for (let j = 0; j < plan.collections.length; j++) {
      const col = plan.collections[j]
      const colParent = col.parentFolderPath ?? ''
      if (img.folderPath === colParent && img.slug === col.slug) {
        errors.push({
          type: 'image',
          index: i,
          field: 'slug',
          message: `Slug "${img.slug}" conflicts with a collection in the same scope`,
        })
      }
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
