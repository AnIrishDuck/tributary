import { TributaryStream } from 'tributary-client'
import * as scribeData from 'scribe-data'
import type { Note } from 'scribe-data'

export async function saveNote(
  stream: TributaryStream,
  content: string,
  inserter: string = 'web-ui',
  blockUuid?: string,
  collectionId?: string | null
) {
  let block: Note

  if (blockUuid) {
    // Update existing note by creating a new version
    block = await scribeData.createNoteVersion(stream, blockUuid, {
      block_type: 'scribe/markdown',
      body: content,
      inserter,
      ...(collectionId !== undefined ? { collection_id: collectionId } : {})
    })
  } else {
    // Create a new note using the scribe-data functions
    block = await scribeData.createNote(stream, {
      block_type: 'scribe/markdown',
      body: content,
      inserter,
      ...(collectionId !== undefined ? { collection_id: collectionId } : {})
    })
  }

  // Sync to ensure persistence
  // Using max of 1000 blobs to prevent memory issues
  await stream.sync(1000)
  // After sync, run indexing on the local database
  const localDb = stream.local()
  await scribeData.indexAll(localDb)

  // The slug is already on the returned note entity
  return { block, blockSlug: { block_uuid: block.block_uuid, slug: block.slug, title: scribeData.extractTitleFromMarkdown(block.body) || '' } }
}
