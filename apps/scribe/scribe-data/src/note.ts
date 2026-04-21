import { v4 as uuidv4 } from 'uuid'
import { TributaryStream, TributaryLocal } from 'tributary-client'
import { Note, PGliteResult, VersionSummary, VersionTreeNode } from './types'
import { getLibrary } from './collection.js'
import { titleToSlug, extractTitleFromMarkdown } from './indexing.js'

/**
 * Create a new note in the database
 * 
 * @param db The TributaryStream database instance
 * @param noteData The note data to insert
 * @returns The inserted note record
 */
export async function createNote(
  db: TributaryStream,
  noteData: {
    block_uuid?: string
    block_type: string
    body: string
    inserter: string
    prior_version_uuid?: string | null
    collection_id?: string | null
    insert_datetime?: string
    slug?: string
  }
): Promise<Note> {
  const now = new Date()

  const blockUuid = noteData.block_uuid || uuidv4()

  // Default collection_id to library root when not specified
  let collection_id = noteData.collection_id ?? null
  if (collection_id === null) {
    const library = await getLibrary(db)
    if (library) {
      collection_id = library.collection_uuid
    }
  }

  // Derive slug: explicit > from title > fall back to block_uuid
  let slug: string
  if (noteData.slug !== undefined) {
    slug = noteData.slug
  } else {
    const title = extractTitleFromMarkdown(noteData.body)
    slug = title ? titleToSlug(title) : blockUuid
  }

  const newNote: Note = {
    block_uuid: blockUuid,
    block_type: noteData.block_type,
    version_uuid: uuidv4(),
    prior_version_uuid: noteData.prior_version_uuid !== undefined ? noteData.prior_version_uuid : null,
    insert_datetime: noteData.insert_datetime ?? now.toISOString(),
    inserter: noteData.inserter,
    body: noteData.body,
    collection_id,
    slug
  }

  await db.exec(
    `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body, collection_id, slug)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      newNote.block_uuid,
      newNote.block_type,
      newNote.version_uuid,
      newNote.prior_version_uuid,
      newNote.insert_datetime,
      newNote.inserter,
      newNote.body,
      newNote.collection_id,
      newNote.slug
    ]
  )

  // Retrieve the inserted note
  const result = await db.query(
    `SELECT * FROM block WHERE version_uuid = $1`,
    [newNote.version_uuid]
  )

  if (!result.rows || result.rows.length === 0) {
    throw new Error('Failed to retrieve inserted note')
  }

  return result.rows[0] as Note
}

/**
 * Create multiple notes in a single SQL statement.
 *
 * All notes are inserted in one INSERT, producing a single stream entry.
 * If any item omits collection_id (or passes null), the library root UUID
 * is resolved once and reused for all such items.
 *
 * @param db The TributaryStream database instance
 * @param items Array of note data to insert
 * @returns Array of inserted note records (same order as input)
 */
export async function createNotes(
  db: TributaryStream,
  items: Array<{
    block_uuid?: string
    block_type: string
    body: string
    inserter: string
    prior_version_uuid?: string | null
    collection_id?: string | null
    insert_datetime?: string
    slug?: string
  }>
): Promise<Note[]> {
  if (items.length === 0) return []

  const now = new Date()

  // Resolve library root once if any item needs it
  let libraryId: string | null = null
  const needsLibrary = items.some(d => (d.collection_id ?? null) === null)
  if (needsLibrary) {
    const library = await getLibrary(db)
    if (library) {
      libraryId = library.collection_uuid
    }
  }

  const notes: Note[] = items.map(noteData => {
    const blockUuid = noteData.block_uuid || uuidv4()
    let collection_id = noteData.collection_id ?? null
    if (collection_id === null && libraryId) {
      collection_id = libraryId
    }

    let slug: string
    if (noteData.slug !== undefined) {
      slug = noteData.slug
    } else {
      const title = extractTitleFromMarkdown(noteData.body)
      slug = title ? titleToSlug(title) : blockUuid
    }

    return {
      block_uuid: blockUuid,
      block_type: noteData.block_type,
      version_uuid: uuidv4(),
      prior_version_uuid: noteData.prior_version_uuid !== undefined ? noteData.prior_version_uuid : null,
      insert_datetime: noteData.insert_datetime ?? now.toISOString(),
      inserter: noteData.inserter,
      body: noteData.body,
      collection_id,
      slug,
    }
  })

  // Build multi-row INSERT: VALUES ($1,...,$9), ($10,...,$18), ...
  const cols = 9
  const valueClauses: string[] = []
  const params: any[] = []
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]
    const base = i * cols
    valueClauses.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`
    )
    params.push(
      n.block_uuid, n.block_type, n.version_uuid, n.prior_version_uuid,
      n.insert_datetime, n.inserter, n.body, n.collection_id, n.slug
    )
  }

  await db.exec(
    `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body, collection_id, slug)
     VALUES ${valueClauses.join(', ')}`,
    params
  )

  return notes
}

/**
 * Create a new version of an existing note
 * 
 * @param db The TributaryStream database instance
 * @param block_uuid The UUID of the note to create a new version for
 * @param noteData The new note data
 * @returns The inserted note record
 */
export async function createNoteVersion(
  db: TributaryStream,
  block_uuid: string,
  noteData: {
    block_type: string
    body: string
    inserter: string
    collection_id?: string | null
    slug?: string
  }
): Promise<Note> {
  // Get the latest version of this note to set as prior_version_uuid and carry forward collection_id and slug
  const result = await db.query(
    `SELECT version_uuid, collection_id, slug FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
    [block_uuid]
  )

  const versionResult = result.rows && result.rows.length > 0 ? result.rows[0] as any : null
  const prior_version_uuid = versionResult ? versionResult.version_uuid : null
  // Use explicitly provided collection_id, otherwise carry forward from latest version
  const collection_id = noteData.collection_id !== undefined ? noteData.collection_id : (versionResult?.collection_id ?? null)
  // Use explicitly provided slug, otherwise carry forward from latest version
  const slug = noteData.slug !== undefined ? noteData.slug : (versionResult?.slug ?? undefined)

  return createNote(db, {
    block_uuid,
    block_type: noteData.block_type,
    body: noteData.body,
    inserter: noteData.inserter,
    prior_version_uuid,
    collection_id,
    slug
  })
}

/**
 * Get a note by its UUID
 * 
 * @param db The TributaryStream database instance
 * @param block_uuid The UUID of the note to retrieve
 * @returns The note record or null if not found
 */
export async function getNoteByUuid(
  db: TributaryStream,
  block_uuid: string
): Promise<Note | null> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
    [block_uuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  
  return result.rows[0] as Note
}

/**
 * Get all versions of a note
 * 
 * @param db The TributaryStream database instance
 * @param block_uuid The UUID of the note to retrieve versions for
 * @returns Array of note records ordered by insertion time
 */
export async function getNoteVersions(
  db: TributaryStream,
  block_uuid: string
): Promise<Note[]> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 ORDER BY insert_datetime ASC`,
    [block_uuid]
  )
  
  return (result.rows || []) as Note[]
}

/**
 * Get the latest version of a note
 * 
 * @param db The TributaryStream database instance
 * @param block_uuid The UUID of the note to retrieve
 * @returns The latest note record or null if not found
 */
export async function getLatestNoteVersion(
  db: TributaryStream,
  block_uuid: string
): Promise<Note | null> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
    [block_uuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return null
  }
  
  return result.rows[0] as Note
}

/**
 * Get the count of all notes in the database
 * 
 * @param db The TributaryStream database instance
 * @returns The number of notes in the database
 */
export async function getNoteCount(
  db: TributaryStream
): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) as count FROM block`,
    []
  )
  
  if (!result.rows || result.rows.length === 0) {
    return 0
  }
  
  return parseInt((result.rows[0] as any).count)
}

/**
 * Get all notes in the database
 * 
 * @param db The TributaryStream database instance
 * @returns Array of all note records
 */
export async function getAllNotes(
  db: TributaryStream
): Promise<Note[]> {
  const result = await db.query(
    `SELECT * FROM block ORDER BY insert_datetime`,
    []
  )
  
  return (result.rows || []) as Note[]
}

/**
 * Get all authoritative (latest) notes in the database
 * 
 * @param db The TributaryStream database instance
 * @returns Array of all authoritative note records
 */
export async function getAllAuthoritativeNotes(
  db: TributaryStream
): Promise<Note[]> {
  const result = await db.query(`
    SELECT b.* 
    FROM block b
    INNER JOIN (
      SELECT block_uuid, MAX(insert_datetime) as max_datetime
      FROM block
      GROUP BY block_uuid
    ) latest ON b.block_uuid = latest.block_uuid AND b.insert_datetime = latest.max_datetime
    ORDER BY b.insert_datetime
  `, [])
  
  return (result.rows || []) as Note[]
}

/**
 * Get the count of versions for a specific note UUID
 * 
 * @param db The TributaryStream or TributaryLocal database instance
 * @param block_uuid The UUID of the note to count versions for
 * @returns The number of versions for the specified note
 */
export async function getNoteVersionCount(
  db: TributaryStream | TributaryLocal,
  block_uuid: string
): Promise<number> {
  const result = await db.query(
    `SELECT COUNT(*) as count FROM block WHERE block_uuid = $1`,
    [block_uuid]
  )
  
  if (!result.rows || result.rows.length === 0) {
    return 0
  }
  
  return parseInt((result.rows[0] as any).count)
}

/**
 * Move a note to a different collection, optionally renaming its slug.
 * Creates a new version of the note with the updated collection_id
 * and optionally updated slug. The body (title) is left unchanged.
 *
 * @param db The TributaryStream database instance
 * @param blockUuid The UUID of the note to move
 * @param newCollectionId The UUID of the target collection, or null for library root
 * @param inserter The user/device identifier
 * @param newSlug Optional new slug for the note
 * @returns The new version of the note
 */
export async function moveNote(
  db: TributaryStream,
  blockUuid: string,
  newCollectionId: string | null,
  inserter: string,
  newSlug?: string
): Promise<Note> {
  const latest = await getLatestNoteVersion(db, blockUuid)
  if (!latest) {
    throw new Error('Note not found')
  }
  return createNoteVersion(db, blockUuid, {
    block_type: latest.block_type,
    body: latest.body,
    inserter,
    collection_id: newCollectionId,
    slug: newSlug
  })
}

/**
 * Get a note by its version UUID
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @param block_uuid The UUID of the note
 * @param version_uuid The UUID of the version to retrieve
 * @returns The note record or null if not found
 */
export async function getNoteByVersion(
  db: TributaryStream | TributaryLocal,
  block_uuid: string,
  version_uuid: string
): Promise<Note | null> {
  const result = await db.query(
    `SELECT * FROM block WHERE block_uuid = $1 AND version_uuid = $2`,
    [block_uuid, version_uuid]
  )

  if (!result.rows || result.rows.length === 0) {
    return null
  }

  return result.rows[0] as Note
}

/**
 * Get the version history of a note with position metadata
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @param block_uuid The UUID of the note to retrieve version history for
 * @param limit Maximum number of versions to return (default 100)
 * @returns Array of VersionSummary objects ordered by insert_datetime ASC, or empty array if note doesn't exist
 */
export async function getVersionHistory(
  db: TributaryStream | TributaryLocal,
  block_uuid: string,
  limit: number = 100
): Promise<VersionSummary[]> {
  const countResult = await db.query(
    `SELECT COUNT(*) as count FROM block WHERE block_uuid = $1`,
    [block_uuid]
  )
  const total = parseInt((countResult.rows?.[0] as any)?.count ?? '0')
  if (total === 0) return []

  const result = await db.query(
    `SELECT version_uuid, prior_version_uuid, insert_datetime, inserter FROM block WHERE block_uuid = $1 ORDER BY insert_datetime ASC LIMIT $2`,
    [block_uuid, limit]
  )

  const rows = (result.rows || []) as Array<{
    version_uuid: string
    prior_version_uuid: string | null
    insert_datetime: string
    inserter: string
  }>

  return rows.map((row, index) => ({
    version_uuid: row.version_uuid,
    prior_version_uuid: row.prior_version_uuid,
    insert_datetime: row.insert_datetime,
    inserter: row.inserter,
    position: index + 1,
    total,
    isAuthoritative: index + 1 === total,
  }))
}

/**
 * Get the version position for a specific version of a note
 *
 * Uses a single query to count versions before the target and the total,
 * avoiding loading all versions into memory.
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @param block_uuid The UUID of the note
 * @param version_uuid The UUID of the version to find
 * @returns The VersionSummary for the specified version, or null if not found
 */
export async function getVersionPosition(
  db: TributaryStream | TributaryLocal,
  block_uuid: string,
  version_uuid: string
): Promise<VersionSummary | null> {
  // Get the target version's row
  const targetResult = await db.query(
    `SELECT version_uuid, prior_version_uuid, insert_datetime, inserter FROM block WHERE block_uuid = $1 AND version_uuid = $2`,
    [block_uuid, version_uuid]
  )

  if (!targetResult.rows || targetResult.rows.length === 0) {
    return null
  }

  const target = targetResult.rows[0] as {
    version_uuid: string
    prior_version_uuid: string | null
    insert_datetime: string
    inserter: string
  }

  // Count versions with insert_datetime <= this version's (gives 1-based position)
  // and total count, in a single query
  const countsResult = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM block WHERE block_uuid = $1 AND insert_datetime <= $2) as position,
       (SELECT COUNT(*) FROM block WHERE block_uuid = $1) as total`,
    [block_uuid, target.insert_datetime]
  )

  const counts = countsResult.rows?.[0] as any
  const position = parseInt(counts.position)
  const total = parseInt(counts.total)

  return {
    version_uuid: target.version_uuid,
    prior_version_uuid: target.prior_version_uuid,
    insert_datetime: target.insert_datetime,
    inserter: target.inserter,
    position,
    total,
    isAuthoritative: position === total,
  }
}

/**
 * Fetch version tree nodes for a note.
 *
 * Returns a flat array of VersionTreeNode objects ordered by
 * `insert_datetime DESC` (newest first). Callers can reconstruct
 * the tree structure from `prior_version_uuid` links if needed.
 * The first entry at offset 0 is always the authoritative version.
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @param block_uuid The UUID of the note
 * @param limit Maximum number of versions to fetch (default 100)
 * @param offset Number of versions to skip (default 0)
 * @returns Array of VersionTreeNode objects, or empty array if no versions exist
 */
export async function getVersionTree(
  db: TributaryStream | TributaryLocal,
  block_uuid: string,
  limit: number = 100,
  offset: number = 0
): Promise<VersionTreeNode[]> {
  const result = await db.query(
    `SELECT version_uuid, prior_version_uuid, insert_datetime, inserter FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT $2 OFFSET $3`,
    [block_uuid, limit, offset]
  )

  const rows = (result.rows || []) as Array<{
    version_uuid: string
    prior_version_uuid: string | null
    insert_datetime: string
    inserter: string
  }>

  return rows.map((row, index) => ({
    version_uuid: row.version_uuid,
    prior_version_uuid: row.prior_version_uuid,
    insert_datetime: row.insert_datetime,
    inserter: row.inserter,
    isAuthoritative: offset === 0 && index === 0,
  }))
}

/**
 * Fetch a single version by its version_uuid alone (no block_uuid needed).
 *
 * @param db The TributaryStream or TributaryLocal database instance
 * @param version_uuid The UUID of the version to retrieve
 * @returns The Note record or null if not found
 */
export async function getVersionByUuid(
  db: TributaryStream | TributaryLocal,
  version_uuid: string
): Promise<Note | null> {
  const result = await db.query(
    `SELECT * FROM block WHERE version_uuid = $1`,
    [version_uuid]
  )

  if (!result.rows || result.rows.length === 0) {
    return null
  }

  return result.rows[0] as Note
}
