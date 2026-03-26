import { v4 as uuidv4 } from 'uuid'
import { TributaryStream } from 'tributary-client'
import { createCollections } from './collection.js'
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
}

export interface BulkUploadPlan {
  collections: BulkCollectionEntry[]
  images: BulkImageEntry[]
  rootCollectionId: string | null
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

  // Pre-assign UUIDs so child entries can reference their parent's UUID
  const collectionMap = new Map<string, string>()
  for (const entry of plan.collections) {
    collectionMap.set(entry.folderPath, uuidv4())
  }

  const items = plan.collections.map(entry => {
    const parentUuid = entry.parentFolderPath === null
      ? plan.rootCollectionId ?? undefined
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

  const items = plan.images.map(entry => {
    const collectionId = entry.folderPath === ''
      ? plan.rootCollectionId ?? undefined
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
