import { TributaryStream } from 'tributary-client'
import { createCollection } from './collection.js'
import { createImageBlock } from './image.js'
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
 * Create sub-collections for a bulk upload plan. Collections must be sorted
 * parents-first so that parent UUIDs are available when creating children.
 *
 * Returns a map from folderPath to the created collection's UUID.
 */
export async function ensureBulkCollections(
  stream: TributaryStream,
  plan: BulkUploadPlan,
  inserter: string,
): Promise<Map<string, string>> {
  const collectionMap = new Map<string, string>()

  for (const entry of plan.collections) {
    const parentUuid = entry.parentFolderPath === null
      ? plan.rootCollectionId ?? undefined
      : collectionMap.get(entry.parentFolderPath)

    const collection = await createCollection(stream, {
      title: entry.title,
      slug: entry.slug,
      parent_collection_uuid: parentUuid,
      inserter,
    })

    collectionMap.set(entry.folderPath, collection.collection_uuid)
  }

  return collectionMap
}

/**
 * Create image blocks for all images in a bulk upload plan.
 * Uses collectionMap (from ensureBulkCollections) to resolve folder paths
 * to collection UUIDs, falling back to rootCollectionId for images at the root.
 */
export async function createBulkImageBlocks(
  stream: TributaryStream,
  plan: BulkUploadPlan,
  collectionMap: Map<string, string>,
  inserter: string,
): Promise<Note[]> {
  const blocks: Note[] = []

  for (const entry of plan.images) {
    const collectionId = entry.folderPath === ''
      ? plan.rootCollectionId ?? undefined
      : collectionMap.get(entry.folderPath)

    const block = await createImageBlock(stream, {
      blobHash: entry.blobHash,
      contentType: entry.contentType,
      fileName: entry.fileName,
      slug: entry.slug,
      title: entry.title,
      width: entry.width,
      height: entry.height,
      collectionId: collectionId ?? null,
      inserter,
    })

    blocks.push(block)
  }

  return blocks
}
