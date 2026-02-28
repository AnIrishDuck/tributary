import { v4 as uuidv4 } from 'uuid'
import { TributaryStream, TributaryLocal } from 'tributary-client'
import { Note, Collection, CollectionSlug, CollectionSlugRow } from './types'
import { titleToSlug } from './indexing.js'
import { moveNote } from './note.js'

/**
 * Create a new collection in the database
 *
 * To create the library, omit parent_collection_uuid (or pass null).
 * Only one library per library is allowed (enforced by DB constraint).
 *
 * To create a named collection, pass the library's UUID as parent_collection_uuid.
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
    linked_stream_id?: string | null
    linked_stream_key?: string | null
  }
): Promise<Collection> {
  const now = new Date()

  const newCollection: Collection = {
    collection_uuid: data.collection_uuid || uuidv4(),
    title: data.title,
    parent_collection_uuid: data.parent_collection_uuid ?? null,
    insert_datetime: now.toISOString(),
    inserter: data.inserter,
    linked_stream_id: data.linked_stream_id ?? null,
    linked_stream_key: data.linked_stream_key ?? null
  }

  await db.exec(
    `INSERT INTO collection (collection_uuid, title, parent_collection_uuid, insert_datetime, inserter, linked_stream_id, linked_stream_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      newCollection.collection_uuid,
      newCollection.title,
      newCollection.parent_collection_uuid,
      newCollection.insert_datetime,
      newCollection.inserter,
      newCollection.linked_stream_id,
      newCollection.linked_stream_key
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
 * Get the library (root collection where parent_collection_uuid IS NULL).
 * Returns null if no library has been created yet (implied "Notes").
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @returns The library or null
 */
export async function getLibrary(
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
 * Get the display name for a library.
 * Returns the library title if one exists, otherwise null
 * (callers should treat null as the default name "Notes").
 *
 * Safe to call on libraries that haven't been migrated yet (returns null).
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @returns The library title, or null if no library exists
 */
export async function getLibraryDisplayName(
  db: TributaryStream | TributaryLocal
): Promise<string | null> {
  try {
    const root = await getLibrary(db)
    return root?.title ?? null
  } catch {
    // collection table may not exist yet on older libraries
    return null
  }
}

/**
 * Get all named collections (direct children of the library).
 * Does not include the library itself.
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
 * Does not include the library.
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
 * Move a collection to a new parent collection.
 *
 * @param db The TributaryStream database instance
 * @param collectionUuid The UUID of the collection to move
 * @param newParentUuid The UUID of the new parent collection
 */
export async function moveCollection(
  db: TributaryStream,
  collectionUuid: string,
  newParentUuid: string
): Promise<void> {
  await db.exec(
    `UPDATE collection SET parent_collection_uuid = $1 WHERE collection_uuid = $2`,
    [newParentUuid, collectionUuid]
  )
}

/**
 * Get a collection by its slug (returns first match for backwards compatibility)
 *
 * @param db The TributaryLocal database instance
 * @param slug The slug to search for
 * @returns The collection slug record or null if not found
 */
export async function getCollectionBySlug(
  db: TributaryLocal,
  slug: string
): Promise<CollectionSlug | null> {
  const results = await getCollectionsBySlug(db, slug)
  return results.length > 0 ? results[0] : null
}

/**
 * Get all collections matching a slug
 *
 * @param db The TributaryLocal database instance
 * @param slug The slug to search for
 * @returns Array of matching collection slug records, or empty array if none found
 */
export async function getCollectionsBySlug(
  db: TributaryLocal,
  slug: string
): Promise<CollectionSlug[]> {
  const result = await db.query(
    `SELECT * FROM collection_slug WHERE slug = $1`,
    [slug]
  )

  return (result.rows || []) as CollectionSlug[]
}

/**
 * Get child collections of a given parent collection.
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @param parentUuid The UUID of the parent collection
 * @returns Array of child collection records, sorted by title
 */
export async function getChildCollections(
  db: TributaryStream | TributaryLocal,
  parentUuid: string
): Promise<Collection[]> {
  const result = await db.query(
    `SELECT * FROM collection WHERE parent_collection_uuid = $1 ORDER BY title`,
    [parentUuid]
  )

  return (result.rows || []) as Collection[]
}

/**
 * Get the ancestor chain for a collection, from root to the given collection.
 * Walks up the parent_collection_uuid chain to build a breadcrumb array.
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @param collectionUuid The UUID of the collection to start from
 * @returns Array of collections from root (library) to the given collection, inclusive
 */
export async function getCollectionAncestors(
  db: TributaryStream | TributaryLocal,
  collectionUuid: string
): Promise<Collection[]> {
  const ancestors: Collection[] = []
  let currentUuid: string | null = collectionUuid

  while (currentUuid) {
    const result = await db.query(
      `SELECT * FROM collection WHERE collection_uuid = $1`,
      [currentUuid]
    )

    if (!result.rows || result.rows.length === 0) {
      break
    }

    const collection = result.rows[0] as Collection
    ancestors.unshift(collection) // prepend to build root-first order
    currentUuid = collection.parent_collection_uuid
  }

  return ancestors
}

/**
 * Get all named collections that have a linked library.
 * Returns collections where parent_collection_uuid IS NOT NULL and
 * linked_stream_id IS NOT NULL, sorted by title.
 *
 * @param db The TributaryStream database instance
 * @returns Array of linked library records, sorted by title
 */
export async function getLinkedLibraries(
  db: TributaryStream
): Promise<Collection[]> {
  const result = await db.query(
    `SELECT * FROM collection
     WHERE parent_collection_uuid IS NOT NULL
       AND linked_stream_id IS NOT NULL
     ORDER BY title`,
    []
  )

  return (result.rows || []) as Collection[]
}

/**
 * Get notes belonging to a specific collection.
 * Pass null for collectionId to get notes in the library
 * (notes with collection_id IS NULL).
 *
 * Returns the latest version of each note.
 *
 * @param db The TributaryStream database instance
 * @param collectionId The collection UUID, or null for library notes
 * @returns Array of notes in the collection
 */
export async function getNotesInCollection(
  db: TributaryStream,
  collectionId: string | null
): Promise<Note[]> {
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

  return (result.rows || []) as Note[]
}

/**
 * Get a collection by its slug scoped to a specific parent collection.
 *
 * @param db The TributaryLocal database instance
 * @param slug The slug to search for
 * @param parentUuid The UUID of the parent collection to scope the search
 * @returns The matching collection slug record or null
 */
export async function getCollectionBySlugUnderParent(
  db: TributaryLocal,
  slug: string,
  parentUuid: string
): Promise<CollectionSlug | null> {
  const result = await db.query(
    `SELECT * FROM collection_slug WHERE slug = $1 AND parent_collection_uuid = $2`,
    [slug, parentUuid]
  )

  if (!result.rows || result.rows.length === 0) {
    return null
  }

  return result.rows[0] as CollectionSlug
}

/**
 * Get the slug path for a collection (excluding the library root).
 * Returns an array of slug segments from the first named collection down to the given collection.
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @param collectionUuid The UUID of the collection
 * @returns Array of slug segments, e.g. ['cooking', 'italian']
 */
export async function getSlugPath(
  db: TributaryStream | TributaryLocal,
  collectionUuid: string
): Promise<string[]> {
  const ancestors = await getCollectionAncestors(db, collectionUuid)

  // Exclude the root/library (first ancestor with parent_collection_uuid === null)
  return ancestors
    .filter(a => a.parent_collection_uuid !== null)
    .map(a => titleToSlug(a.title))
}

/**
 * Get the full slug path for a note, including its collection ancestors and own slug.
 *
 * @param db The TributaryLocal database instance
 * @param noteBlockUuid The block UUID of the note
 * @returns Array of slug segments, e.g. ['cooking', 'italian', 'pasta']
 */
export async function getNoteSlugPath(
  db: TributaryLocal,
  noteBlockUuid: string
): Promise<string[]> {
  // Get the note's slug
  const slugResult = await db.query(
    `SELECT * FROM block_slug WHERE block_uuid = $1`,
    [noteBlockUuid]
  )

  if (!slugResult.rows || slugResult.rows.length === 0) {
    return []
  }

  const noteSlug = (slugResult.rows[0] as any).slug as string

  // Get the note's collection_id from the authoritative version
  const noteResult = await db.query(
    `SELECT b.collection_id FROM block b
     INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
     WHERE b.block_uuid = $1`,
    [noteBlockUuid]
  )

  if (!noteResult.rows || noteResult.rows.length === 0) {
    return [noteSlug]
  }

  const collectionId = (noteResult.rows[0] as any).collection_id

  if (!collectionId) {
    return [noteSlug]
  }

  // Build the collection slug path and append the note slug
  const collectionPath = await getSlugPath(db, collectionId)
  return [...collectionPath, noteSlug]
}

/**
 * Find all notes whose latest version has collection_id IS NULL and
 * move them to the root collection (library).
 *
 * Should only be called after sync for this library has completed.
 *
 * @param stream The TributaryStream for the library
 * @returns The number of notes that were fixed
 */
export async function fixNullParentNotes(
  stream: TributaryStream
): Promise<number> {
  const library = await getLibrary(stream)
  if (!library) {
    console.log('[fixNullParentNotes] No root collection found, skipping')
    return 0
  }

  const rootUuid = library.collection_uuid

  // Find latest version of each note where collection_id is null
  const result = await stream.query(
    `SELECT b.block_uuid, b.collection_id FROM block b
     INNER JOIN (
       SELECT block_uuid, MAX(insert_datetime) as max_datetime
       FROM block
       GROUP BY block_uuid
     ) latest ON b.block_uuid = latest.block_uuid AND b.insert_datetime = latest.max_datetime
     WHERE b.collection_id IS NULL`,
    []
  )

  const orphanedNotes = (result.rows || []) as Array<{ block_uuid: string; collection_id: string | null }>

  if (orphanedNotes.length === 0) {
    return 0
  }

  console.log(`[fixNullParentNotes] Found ${orphanedNotes.length} notes with null parent:`)
  for (const note of orphanedNotes) {
    console.log(`  - note ${note.block_uuid} parent=${note.collection_id}`)
  }

  console.log(`[fixNullParentNotes] Moving ${orphanedNotes.length} notes to root collection ${rootUuid}`)
  for (const note of orphanedNotes) {
    await moveNote(stream, note.block_uuid, rootUuid, 'auto-fix')
  }

  console.log(`[fixNullParentNotes] Done, fixed ${orphanedNotes.length} notes`)
  return orphanedNotes.length
}

