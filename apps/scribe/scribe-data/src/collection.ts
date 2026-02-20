import { v4 as uuidv4 } from 'uuid'
import { TributaryStream, TributaryLocal } from 'tributary-client'
import { Block, Collection, CollectionSlug, CollectionSlugRow } from './types'

/**
 * Create a new collection in the database
 *
 * To create the root collection, omit parent_collection_uuid (or pass null).
 * Only one root collection per stream is allowed (enforced by DB constraint).
 *
 * To create a named collection, pass the root collection's UUID as parent_collection_uuid.
 *
 * @param db The TributaryStream database instance
 * @param data The collection data to insert
 * @returns The inserted collection record
 */
export async function createCollection(
  db: TributaryStream,
  data: {
    collection_uuid?: string
    title: string
    parent_collection_uuid?: string | null
    inserter: string
  }
): Promise<Collection> {
  const now = new Date()

  const newCollection: Collection = {
    collection_uuid: data.collection_uuid || uuidv4(),
    title: data.title,
    parent_collection_uuid: data.parent_collection_uuid ?? null,
    insert_datetime: now.toISOString(),
    inserter: data.inserter
  }

  await db.exec(
    `INSERT INTO collection (collection_uuid, title, parent_collection_uuid, insert_datetime, inserter)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      newCollection.collection_uuid,
      newCollection.title,
      newCollection.parent_collection_uuid,
      newCollection.insert_datetime,
      newCollection.inserter
    ]
  )

  return newCollection
}

/**
 * Get a collection by its UUID
 *
 * @param db The TributaryStream database instance
 * @param uuid The collection UUID
 * @returns The collection record or null if not found
 */
export async function getCollectionByUuid(
  db: TributaryStream,
  uuid: string
): Promise<Collection | null> {
  const result = await db.query(
    `SELECT * FROM collection WHERE collection_uuid = $1`,
    [uuid]
  )

  if (!result.rows || result.rows.length === 0) {
    return null
  }

  return result.rows[0] as Collection
}

/**
 * Get the root collection for the stream (parent_collection_uuid IS NULL).
 * Returns null if no root collection has been created yet (implied "Notes").
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @returns The root collection or null
 */
export async function getRootCollection(
  db: TributaryStream | TributaryLocal
): Promise<Collection | null> {
  const result = await db.query(
    `SELECT * FROM collection WHERE parent_collection_uuid IS NULL`,
    []
  )

  if (!result.rows || result.rows.length === 0) {
    return null
  }

  return result.rows[0] as Collection
}

/**
 * Get the display name for a stream.
 * Returns the root collection title if one exists, otherwise null
 * (callers should treat null as the default name "Notes").
 *
 * Safe to call on streams that haven't been migrated yet (returns null).
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @returns The root collection title, or null if no root collection exists
 */
export async function getStreamDisplayName(
  db: TributaryStream | TributaryLocal
): Promise<string | null> {
  try {
    const root = await getRootCollection(db)
    return root?.title ?? null
  } catch {
    // collection table may not exist yet on older streams
    return null
  }
}

/**
 * Get all named collections (direct children of the root collection).
 * Does not include the root collection itself.
 *
 * @param db The TributaryStream database instance
 * @returns Array of named collection records, sorted by title
 */
export async function getAllCollections(
  db: TributaryStream
): Promise<Collection[]> {
  const result = await db.query(
    `SELECT * FROM collection WHERE parent_collection_uuid IS NOT NULL ORDER BY title`,
    []
  )

  return (result.rows || []) as Collection[]
}

/**
 * Get all named collections with their slugs for listing.
 * Does not include the root collection.
 *
 * @param db The TributaryLocal database instance
 * @returns Array of collection slug rows
 */
export async function getAllCollectionsWithSlugs(
  db: TributaryLocal
): Promise<CollectionSlugRow[]> {
  const result = await db.query(
    `SELECT c.collection_uuid, c.insert_datetime, cs.slug, cs.title, cs.indexed_at
     FROM collection c
     INNER JOIN collection_slug cs ON c.collection_uuid = cs.collection_uuid
     WHERE c.parent_collection_uuid IS NOT NULL
     ORDER BY cs.title`,
    []
  )

  return (result.rows || []) as CollectionSlugRow[]
}

/**
 * Get a collection by its slug
 *
 * @param db The TributaryLocal database instance
 * @param slug The slug to search for
 * @returns The collection slug record or null if not found
 */
export async function getCollectionBySlug(
  db: TributaryLocal,
  slug: string
): Promise<CollectionSlug | null> {
  const result = await db.query(
    `SELECT * FROM collection_slug WHERE slug = $1`,
    [slug]
  )

  if (!result.rows || result.rows.length === 0) {
    return null
  }

  return result.rows[0] as CollectionSlug
}

/**
 * Get blocks belonging to a specific collection.
 * Pass null for collectionId to get blocks in the root collection
 * (blocks with collection_id IS NULL).
 *
 * Returns the latest version of each block.
 *
 * @param db The TributaryStream database instance
 * @param collectionId The collection UUID, or null for root collection blocks
 * @returns Array of blocks in the collection
 */
export async function getBlocksInCollection(
  db: TributaryStream,
  collectionId: string | null
): Promise<Block[]> {
  let result
  if (collectionId === null) {
    result = await db.query(
      `SELECT b.* FROM block b
       INNER JOIN (
         SELECT block_uuid, MAX(insert_datetime) as max_datetime
         FROM block
         GROUP BY block_uuid
       ) latest ON b.block_uuid = latest.block_uuid AND b.insert_datetime = latest.max_datetime
       WHERE b.collection_id IS NULL
       ORDER BY b.insert_datetime DESC`,
      []
    )
  } else {
    result = await db.query(
      `SELECT b.* FROM block b
       INNER JOIN (
         SELECT block_uuid, MAX(insert_datetime) as max_datetime
         FROM block
         GROUP BY block_uuid
       ) latest ON b.block_uuid = latest.block_uuid AND b.insert_datetime = latest.max_datetime
       WHERE b.collection_id = $1
       ORDER BY b.insert_datetime DESC`,
      [collectionId]
    )
  }

  return (result.rows || []) as Block[]
}
