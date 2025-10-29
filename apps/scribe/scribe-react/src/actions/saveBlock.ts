import { TributaryStream } from 'tributary-client'
import { Kysely } from 'kysely'
import { KyselyTributary } from 'kysely-tributary'
import * as scribeData from 'scribe-data'

export async function saveBlock(
  stream: TributaryStream,
  content: string,
  inserter: string = 'web-ui'
) {
  // Create Tributary dialect for synced operations
  const { dialect } = new KyselyTributary(stream)
  const syncedDb = new Kysely<any>({ dialect })
  
  // Create a new block
  const block = await scribeData.createBlock(syncedDb, {
    block_type: 'scribe/markdown',
    body: content,
    inserter
  })
  
  // Sync to ensure persistence
  await stream.sync()
  
  // After sync, create a local database and then run indexing on it
  const { dialect: localDialect } = new KyselyTributary(stream.local())
  const localDb = new Kysely<any>({ dialect: localDialect })
  
  // Run indexing on the local database
  const { indexSlugs } = await import('scribe-data')
  await indexSlugs(localDb)
  
  // Get the slug for this block from the local database
  const { getBlockSlugByUuid } = await import('scribe-data')
  const blockSlug = await getBlockSlugByUuid(localDb, block.block_uuid)
  
  return { block, blockSlug }
}
