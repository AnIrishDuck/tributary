import { v4 as uuidv4 } from 'uuid'
import { TributaryStream, TributaryLocal } from 'tributary-client'
import { Note, PGliteResult } from './types'

interface NoteQueryResult {
  version_uuid: string;
}

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
  }
): Promise<Note> {
  const now = new Date()

  const newNote: Note = {
    block_uuid: noteData.block_uuid || uuidv4(),
    block_type: noteData.block_type,
    version_uuid: uuidv4(),
    prior_version_uuid: noteData.prior_version_uuid !== undefined ? noteData.prior_version_uuid : null,
    insert_datetime: noteData.insert_datetime ?? now.toISOString(),
    inserter: noteData.inserter,
    body: noteData.body,
    collection_id: noteData.collection_id ?? null
  }

  await db.exec(
    `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body, collection_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      newNote.block_uuid,
      newNote.block_type,
      newNote.version_uuid,
      newNote.prior_version_uuid,
      newNote.insert_datetime,
      newNote.inserter,
      newNote.body,
      newNote.collection_id
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
  }
): Promise<Note> {
  // Get the latest version of this note to set as prior_version_uuid and carry forward collection_id
  const result = await db.query(
    `SELECT version_uuid, collection_id FROM block WHERE block_uuid = $1 ORDER BY insert_datetime DESC LIMIT 1`,
    [block_uuid]
  )

  const versionResult = result.rows && result.rows.length > 0 ? result.rows[0] as any : null
  const prior_version_uuid = versionResult ? versionResult.version_uuid : null
  // Use explicitly provided collection_id, otherwise carry forward from latest version
  const collection_id = noteData.collection_id !== undefined ? noteData.collection_id : (versionResult?.collection_id ?? null)

  return createNote(db, {
    block_uuid,
    block_type: noteData.block_type,
    body: noteData.body,
    inserter: noteData.inserter,
    prior_version_uuid,
    collection_id
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
 * Move a note to a different collection.
 * Creates a new version of the note with the updated collection_id.
 * The note's content (body) remains unchanged.
 *
 * @param db The TributaryStream database instance
 * @param blockUuid The UUID of the note to move
 * @param newCollectionId The UUID of the target collection, or null for library root
 * @param inserter The user/device identifier
 * @returns The new version of the note
 */
export async function moveNote(
  db: TributaryStream,
  blockUuid: string,
  newCollectionId: string | null,
  inserter: string
): Promise<Note> {
  const latest = await getLatestNoteVersion(db, blockUuid)
  if (!latest) {
    throw new Error('Note not found')
  }
  return createNoteVersion(db, blockUuid, {
    block_type: latest.block_type,
    body: latest.body,
    inserter,
    collection_id: newCollectionId
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
