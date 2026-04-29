import { v4 as uuidv4 } from 'uuid'
import { TributaryStream, TributaryLocal } from 'tributary-client'
import { Note, Collection, CollectionSlug, CollectionSlugRow, CollectionOptions, MergedCollectionOptions } from './types'
import { titleToSlug, getNotesBySlugInCollection } from './indexing.js'

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
    slug?: string
  }
): Promise<Collection> {
  const now = new Date()

  const slug = data.slug !== undefined ? data.slug : titleToSlug(data.title)

  const newCollection: Collection = {
    collection_uuid: data.collection_uuid || uuidv4(),
    title: data.title,
    parent_collection_uuid: data.parent_collection_uuid ?? null,
    insert_datetime: now.toISOString(),
    inserter: data.inserter,
    linked_stream_id: data.linked_stream_id ?? null,
    linked_stream_key: data.linked_stream_key ?? null,
    slug
  }

  await db.exec(
    `INSERT INTO collection (collection_uuid, title, parent_collection_uuid, insert_datetime, inserter, linked_stream_id, linked_stream_key, slug)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      newCollection.collection_uuid,
      newCollection.title,
      newCollection.parent_collection_uuid,
      newCollection.insert_datetime,
      newCollection.inserter,
      newCollection.linked_stream_id,
      newCollection.linked_stream_key,
      newCollection.slug
    ]
  )

  return newCollection
}

/**
 * Create multiple collections in a single SQL statement.
 *
 * All collections are inserted in one INSERT, producing a single stream entry.
 * Items are processed in order — callers must sort parents-first when
 * parent_collection_uuid references another item in the same batch.
 *
 * @param db The TributaryStream database instance
 * @param items Array of collection data to insert
 * @returns Array of inserted collection records (same order as input)
 */
export async function createCollections(
  db: TributaryStream,
  items: Array<{
    collection_uuid?: string
    title: string
    parent_collection_uuid?: string | null
    inserter: string
    linked_stream_id?: string | null
    linked_stream_key?: string | null
    slug?: string
  }>
): Promise<Collection[]> {
  if (items.length === 0) return []

  const now = new Date()
  const collections: Collection[] = items.map(data => ({
    collection_uuid: data.collection_uuid || uuidv4(),
    title: data.title,
    parent_collection_uuid: data.parent_collection_uuid ?? null,
    insert_datetime: now.toISOString(),
    inserter: data.inserter,
    linked_stream_id: data.linked_stream_id ?? null,
    linked_stream_key: data.linked_stream_key ?? null,
    slug: data.slug !== undefined ? data.slug : titleToSlug(data.title),
  }))

  // Build multi-row INSERT: VALUES ($1,...,$8), ($9,...,$16), ...
  const cols = 8
  const valueClauses: string[] = []
  const params: any[] = []
  for (let i = 0; i < collections.length; i++) {
    const c = collections[i]
    const base = i * cols
    valueClauses.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`
    )
    params.push(
      c.collection_uuid, c.title, c.parent_collection_uuid,
      c.insert_datetime, c.inserter,
      c.linked_stream_id, c.linked_stream_key, c.slug
    )
  }

  await db.exec(
    `INSERT INTO collection (collection_uuid, title, parent_collection_uuid, insert_datetime, inserter, linked_stream_id, linked_stream_key, slug)
     VALUES ${valueClauses.join(', ')}`,
    params
  )

  return collections
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
 * Queries the synced collection table directly (no join needed).
 * Does not include the library.
 *
 * @param db The TributaryLocal database instance
 * @returns Array of collection slug rows
 */
export async function getAllCollectionsWithSlugs(
  db: TributaryLocal
): Promise<CollectionSlugRow[]> {
  const result = await db.query(
    `SELECT collection_uuid, slug, title, insert_datetime
     FROM collection
     WHERE parent_collection_uuid IS NOT NULL
     ORDER BY title`,
    []
  )

  return (result.rows || []) as CollectionSlugRow[]
}

/**
 * Rename a collection's title.
 *
 * @param db The TributaryStream database instance
 * @param collectionUuid The UUID of the collection to rename
 * @param newTitle The new title for the collection
 */
export async function renameCollection(
  db: TributaryStream,
  collectionUuid: string,
  newTitle: string
): Promise<void> {
  await db.exec(
    `UPDATE collection SET title = $1 WHERE collection_uuid = $2`,
    [newTitle, collectionUuid]
  )
}

/**
 * Move a collection to a new parent collection, optionally renaming its slug.
 * The collection title is left unchanged.
 *
 * @param db The TributaryStream database instance
 * @param collectionUuid The UUID of the collection to move
 * @param newParentUuid The UUID of the new parent collection
 * @param newSlug Optional new slug for the collection
 */
export async function moveCollection(
  db: TributaryStream,
  collectionUuid: string,
  newParentUuid: string,
  newSlug?: string
): Promise<void> {
  if (newSlug !== undefined) {
    await db.exec(
      `UPDATE collection SET parent_collection_uuid = $1, slug = $2 WHERE collection_uuid = $3`,
      [newParentUuid, newSlug, collectionUuid]
    )
  } else {
    await db.exec(
      `UPDATE collection SET parent_collection_uuid = $1 WHERE collection_uuid = $2`,
      [newParentUuid, collectionUuid]
    )
  }
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
 * Get all collections matching a slug.
 * Queries the synced collection table directly.
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
    `SELECT collection_uuid, slug, title, parent_collection_uuid
     FROM collection WHERE slug = $1 AND parent_collection_uuid IS NOT NULL`,
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
  let resolvedId = collectionId
  if (resolvedId === null) {
    const library = await getLibrary(db)
    if (library) {
      resolvedId = library.collection_uuid
    }
  }

  let result
  if (resolvedId === null) {
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
      [resolvedId]
    )
  }

  return (result.rows || []) as Note[]
}

/**
 * Get a collection by its slug scoped to a specific parent collection.
 * Queries the synced collection table directly.
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
    `SELECT collection_uuid, slug, title, parent_collection_uuid
     FROM collection WHERE slug = $1 AND parent_collection_uuid = $2`,
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
 * Uses the synced collection.slug column directly.
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
    .map(a => a.slug)
}

/**
 * Get the full slug path for a note, including its collection ancestors and own slug.
 * Uses block.slug from the authoritative version and collection.slug from ancestors.
 *
 * @param db The TributaryLocal database instance
 * @param noteBlockUuid The block UUID of the note
 * @returns Array of slug segments, e.g. ['cooking', 'italian', 'pasta']
 */
export async function getNoteSlugPath(
  db: TributaryLocal,
  noteBlockUuid: string
): Promise<string[]> {
  // Get the note's slug and collection_id from the authoritative version
  const result = await db.query(
    `SELECT b.slug, b.collection_id FROM block b
     INNER JOIN authoritative_version av ON b.block_uuid = av.block_uuid AND b.version_uuid = av.version_uuid
     WHERE b.block_uuid = $1`,
    [noteBlockUuid]
  )

  if (!result.rows || result.rows.length === 0) {
    return []
  }

  const row = result.rows[0] as { slug: string; collection_id: string | null }
  const noteSlug = row.slug
  const collectionId = row.collection_id

  if (!collectionId) {
    return [noteSlug]
  }

  // Build the collection slug path and append the note slug
  const collectionPath = await getSlugPath(db, collectionId)
  return [...collectionPath, noteSlug]
}

/**
 * Check if moving/renaming an entity to the given slug at the target collection
 * would result in a slug collision with existing entities.
 *
 * @param localDb The TributaryLocal database instance
 * @param targetSlug The slug the entity would have at the target location
 * @param targetCollectionId The target collection UUID for note lookup (null resolves to library root)
 * @param targetParentUuid The parent UUID for collection collision checks
 * @param excludeUuid The UUID of the entity being moved (excluded from collision check)
 * @returns true if there would be a collision
 */
export async function checkMoveCollision(
  localDb: TributaryLocal,
  targetSlug: string,
  targetCollectionId: string | null,
  targetParentUuid: string,
  excludeUuid: string
): Promise<boolean> {
  // Check for note collisions
  const collidingNotes = await getNotesBySlugInCollection(localDb, targetSlug, targetCollectionId)
  if (collidingNotes.some(n => n.block_uuid !== excludeUuid)) {
    return true
  }

  // Check for collection collisions
  const collidingCollection = await getCollectionBySlugUnderParent(localDb, targetSlug, targetParentUuid)
  if (collidingCollection && collidingCollection.collection_uuid !== excludeUuid) {
    return true
  }

  return false
}

/**
 * Get the full parent chain for a collection using a single recursive CTE query.
 * Returns an array ordered from root (library) to the given collection, inclusive.
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @param collectionUuid The UUID of the collection to start from
 * @returns Array of collections from root (library) to the given collection
 */
export async function getParentChain(
  db: TributaryStream | TributaryLocal,
  collectionUuid: string
): Promise<Collection[]> {
  const result = await db.query(
    `WITH RECURSIVE chain AS (
       SELECT *, 0 AS depth FROM collection WHERE collection_uuid = $1
       UNION ALL
       SELECT c.*, chain.depth + 1 FROM collection c
       INNER JOIN chain ON c.collection_uuid = chain.parent_collection_uuid
     )
     SELECT * FROM chain ORDER BY depth DESC`,
    [collectionUuid]
  )

  if (!result.rows) return []

  // Strip the depth column from results
  return result.rows.map((row) => {
    const { depth, ...collection } = row as Collection & { depth: number }
    return collection as Collection
  })
}

/**
 * Get the merged options for a collection by walking its full parent chain.
 * Options are merged additively from root to leaf — child keys override
 * parent keys when present (shallow merge).
 *
 * Uses a single SQL query to fetch the entire chain with options.
 * Returns empty results gracefully if the options column does not exist (pre-migration).
 *
 * @param db The TributaryStream database instance
 * @param collectionUuid The UUID of the collection
 * @returns `merged`: the final options object; `sources`: map of each key to the collection_uuid it came from
 */
export async function mergeParentChainOptions(
  db: TributaryStream,
  collectionUuid: string
): Promise<MergedCollectionOptions> {
  try {
    const result = await db.query(
      `WITH RECURSIVE chain AS (
         SELECT collection_uuid, parent_collection_uuid, options, 0 AS depth
         FROM collection WHERE collection_uuid = $1
         UNION ALL
         SELECT c.collection_uuid, c.parent_collection_uuid, c.options, chain.depth + 1
         FROM collection c
         INNER JOIN chain ON c.collection_uuid = chain.parent_collection_uuid
       )
       SELECT collection_uuid, options FROM chain ORDER BY depth DESC`,
      [collectionUuid]
    )

    if (!result.rows || result.rows.length === 0) return { merged: {}, sources: {} }

    let merged: CollectionOptions = {}
    const sources: Record<string, string> = {}
    for (const row of result.rows as Array<{ collection_uuid: string; options: string }>) {
      const uuid = row.collection_uuid
      const opts = JSON.parse(row.options)
      for (const key of Object.keys(opts)) {
        sources[key] = uuid
      }
      merged = { ...merged, ...opts }
    }
    return { merged, sources }
  } catch (err: any) {
    if (err?.code === UNDEFINED_COLUMN) {
      return { merged: {}, sources: {} }
    }
    throw err
  }
}

/** PostgreSQL error code for "undefined column". */
const UNDEFINED_COLUMN = '42703'

/**
 * Get the options JSON for a collection. Returns an empty object if the
 * `options` column does not exist yet (library has not been migrated).
 * This makes the read non-view-blocking — callers never need to wait for
 * the migration before rendering.
 *
 * @param db The TributaryStream database instance
 * @param collectionUuid The collection UUID
 * @returns Parsed options object, or {} if the column is missing or the collection is not found
 */
export async function getCollectionOptions(
  db: TributaryStream,
  collectionUuid: string
): Promise<CollectionOptions> {
  try {
    const result = await db.query(
      `SELECT options FROM collection WHERE collection_uuid = $1`,
      [collectionUuid]
    )
    if (!result.rows || result.rows.length === 0) {
      return {}
    }
    return JSON.parse((result.rows[0] as { options: string }).options)
  } catch (err: any) {
    if (err?.code === UNDEFINED_COLUMN) {
      // Column doesn't exist — library predates the options migration
      return {}
    }
    throw err
  }
}

/**
 * Set the options JSON for a collection. The `options` column must already
 * exist (i.e. the migration must have run). Throws if the column is missing.
 *
 * @param db The TributaryStream database instance
 * @param collectionUuid The collection UUID
 * @param options The options object to store (will be JSON-serialized)
 */
export async function setCollectionOptions(
  db: TributaryStream,
  collectionUuid: string,
  options: CollectionOptions
): Promise<void> {
  await db.exec(
    `UPDATE collection SET options = $1 WHERE collection_uuid = $2`,
    [JSON.stringify(options), collectionUuid]
  )
}

