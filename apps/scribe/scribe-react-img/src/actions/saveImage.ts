import { TributaryStream, createLogger } from 'tributary-client'
import * as scribeData from 'scribe-data'
import type { Note } from 'scribe-data'
import { generateThumbnail } from '../utils/thumbnail'

const { info } = createLogger('scribe-react-img')

export interface SaveImageParams {
  fileData: Uint8Array
  contentType: string
  fileName: string
  slug: string
  title?: string
  width?: number
  height?: number
  collectionId?: string | null
}

export async function saveImage(
  stream: TributaryStream,
  params: SaveImageParams,
  inserter: string = 'web-ui'
): Promise<{ block: Note; slugPath: string[] }> {
  // Upload the image blob
  const blob = stream.blob()
  const blobHash = await blob.upload(params.fileData)

  // Generate and upload thumbnail
  const thumbData = await generateThumbnail(params.fileData, params.contentType)
  const thumbBlobHash = await blob.upload(thumbData)

  // Create the image block
  const block = await scribeData.createImageBlock(stream, {
    blobHash,
    contentType: params.contentType,
    slug: params.slug,
    title: params.title,
    fileName: params.fileName,
    width: params.width,
    height: params.height,
    collectionId: params.collectionId,
    inserter,
    thumbBlobHash,
  })

  // Sync to ensure persistence
  const syncStatus = await stream.sync(1000)
  info(`Image saved and synced: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`)

  // After sync, run indexing on the local database
  const localDb = stream.local()
  await scribeData.indexAll(localDb)

  // Get the slug path for navigation
  const slugPath = await scribeData.getNoteSlugPath(localDb, block.block_uuid)

  return { block, slugPath }
}
