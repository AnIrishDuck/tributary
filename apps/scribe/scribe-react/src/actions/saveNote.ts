import { TributaryStream } from 'tributary-client'
import * as scribeData from 'scribe-data'

export async function saveNote(
  stream: TributaryStream,
  content: string,
  inserter: string = 'web-ui',
  blockUuid?: string,
  collectionId?: string | null
) {
  let block: any

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
  const syncStatus = await stream.sync(1000)
  console.log(`Note saved and synced: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`)
  
  // After sync, create a local database and then run indexing on it
  const localDb = stream.local()
  
  // Run indexing on the local database
  await scribeData.indexAll(localDb)

  // Get the slug for this note from the local database
  const blockSlug = await scribeData.getNoteSlugByUuid(localDb, block.block_uuid)
  
  return { block, blockSlug }
}
