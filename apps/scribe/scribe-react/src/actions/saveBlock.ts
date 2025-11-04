import { TributaryStream } from 'tributary-client'
import * as scribeData from 'scribe-data'

export async function saveBlock(
  stream: TributaryStream,
  content: string,
  inserter: string = 'web-ui'
) {
  // Create a new block using the scribe-data functions
  const block = await scribeData.createBlock(stream, {
    block_type: 'scribe/markdown',
    body: content,
    inserter
  })
  
  // Sync to ensure persistence
  await stream.sync()
  
  // After sync, create a local database and then run indexing on it
  const localDb = stream.local()
  
  // Run indexing on the local database
  const { indexSlugs } = await import('scribe-data')
  await indexSlugs(localDb)
  
  // Get the slug for this block from the local database
  const { getBlockSlugByUuid } = await import('scribe-data')
  const blockSlug = await getBlockSlugByUuid(localDb, block.block_uuid)
  
  return { block, blockSlug }
}
