import { TributaryStream, TributaryLocal } from 'tributary-client'
import { Note, ImageBlockBody, NoteSlug } from './types'
import { createNote, createNotes, createNoteVersion, getLatestNoteVersion } from './note.js'
import { getNotesBySlugInCollection, extractTitleFromMarkdown } from './indexing.js'

/**
 * Parse the JSON body of an image block into an ImageBlockBody.
 *
 * @param note The note (block) to parse
 * @returns The parsed ImageBlockBody
 * @throws If the body is not valid JSON or missing required fields
 */
export function parseImageBlockBody(note: Note): ImageBlockBody {
  const parsed = JSON.parse(note.body)
  if (!parsed.blobHash || !parsed.contentType) {
    throw new Error('Invalid image block body: missing blobHash or contentType')
  }
  return parsed as ImageBlockBody
}

/**
 * Create a new image block.
 *
 * @param db The TributaryStream database instance
 * @param data Image block data
 * @returns The inserted note record
 */
export async function createImageBlock(
  db: TributaryStream,
  data: {
    blobHash: string
    contentType: string
    altText?: string
    width?: number
    height?: number
    fileName?: string
    slug: string
    title?: string
    collectionId?: string | null
    inserter: string
  }
): Promise<Note> {
  const body: ImageBlockBody = {
    blobHash: data.blobHash,
    contentType: data.contentType,
    title: data.title,
    altText: data.altText,
    width: data.width,
    height: data.height,
    fileName: data.fileName,
  }

  return createNote(db, {
    block_type: 'scribe/image',
    body: JSON.stringify(body),
    inserter: data.inserter,
    collection_id: data.collectionId,
    slug: data.slug,
  })
}

/**
 * Create multiple image blocks in a single SQL statement.
 *
 * All blocks are inserted in one INSERT, producing a single stream entry.
 *
 * @param db The TributaryStream database instance
 * @param items Array of image block data
 * @returns Array of inserted note records (same order as input)
 */
export async function createImageBlocks(
  db: TributaryStream,
  items: Array<{
    blobHash: string
    contentType: string
    altText?: string
    width?: number
    height?: number
    fileName?: string
    slug: string
    title?: string
    collectionId?: string | null
    inserter: string
  }>
): Promise<Note[]> {
  if (items.length === 0) return []

  const noteItems = items.map(data => {
    const body: ImageBlockBody = {
      blobHash: data.blobHash,
      contentType: data.contentType,
      title: data.title,
      altText: data.altText,
      width: data.width,
      height: data.height,
      fileName: data.fileName,
    }
    return {
      block_type: 'scribe/image' as const,
      body: JSON.stringify(body),
      inserter: data.inserter,
      collection_id: data.collectionId,
      slug: data.slug,
    }
  })

  return createNotes(db, noteItems)
}

/**
 * Update an existing image block by creating a new version.
 *
 * @param db The TributaryStream database instance
 * @param blockUuid The UUID of the image block to update
 * @param updates Fields to update (slug, title, or new blob metadata)
 * @returns The new version of the image block
 */
export async function updateImageBlock(
  db: TributaryStream,
  blockUuid: string,
  updates: {
    blobHash?: string
    contentType?: string
    title?: string
    altText?: string
    width?: number
    height?: number
    fileName?: string
    slug?: string
    collectionId?: string | null
    inserter: string
  }
): Promise<Note> {
  const latest = await getLatestNoteVersion(db, blockUuid)
  if (!latest) {
    throw new Error('Image block not found')
  }

  // Merge existing body with updates
  const existingBody = parseImageBlockBody(latest)
  const newBody: ImageBlockBody = {
    blobHash: updates.blobHash ?? existingBody.blobHash,
    contentType: updates.contentType ?? existingBody.contentType,
    title: updates.title !== undefined ? updates.title : existingBody.title,
    altText: updates.altText !== undefined ? updates.altText : existingBody.altText,
    width: updates.width !== undefined ? updates.width : existingBody.width,
    height: updates.height !== undefined ? updates.height : existingBody.height,
    fileName: updates.fileName !== undefined ? updates.fileName : existingBody.fileName,
  }

  return createNoteVersion(db, blockUuid, {
    block_type: 'scribe/image',
    body: JSON.stringify(newBody),
    inserter: updates.inserter,
    collection_id: updates.collectionId,
    slug: updates.slug,
  })
}

/**
 * Get an image block by slug within a collection.
 *
 * @param db The TributaryLocal database instance
 * @param slug The slug to search for
 * @param collectionId The collection UUID, or null for library root
 * @returns The matching image block and parsed body, or null
 */
export async function getImageBySlug(
  db: TributaryLocal,
  slug: string,
  collectionId: string | null
): Promise<{ note: NoteSlug; body: ImageBlockBody } | null> {
  // getNotesBySlugInCollection returns all blocks matching the slug (including images)
  // We need to filter to only image blocks by querying block_type
  let result
  if (collectionId === null) {
    result = await db.query(
      `SELECT b.block_uuid, b.slug, b.body, b.block_type
       FROM block b
       INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
       WHERE b.slug = $1 AND b.collection_id IS NULL AND b.block_type = 'scribe/image' AND b.archived = FALSE`,
      [slug]
    )
  } else {
    result = await db.query(
      `SELECT b.block_uuid, b.slug, b.body, b.block_type
       FROM block b
       INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
       WHERE b.slug = $1 AND b.collection_id = $2 AND b.block_type = 'scribe/image' AND b.archived = FALSE`,
      [slug, collectionId]
    )
  }

  if (!result.rows || result.rows.length === 0) {
    return null
  }

  const row = result.rows[0] as any
  const body = JSON.parse(row.body) as ImageBlockBody
  return {
    note: {
      block_uuid: row.block_uuid,
      slug: row.slug,
      title: body.title || body.altText || body.fileName || '',
    },
    body,
  }
}
