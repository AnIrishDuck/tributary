import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { BlockUuid, VersionUuid } from '../src/types.js'
import { up, down } from '../src/migrations.js'
import { createTestDB } from './test-utils.js'
import { 
  createNote, 
  createNoteVersion, 
  getNoteByUuid, 
  getNoteVersions, 
  getLatestNoteVersion,
  getNoteCount
} from '../src/note.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'

describe('Note Operations', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    // Create a fresh test database for each test
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    cleanup = async () => {
      // Cleanup handled by test framework
    }
    
    // Run the migration
    await up(syncedDb, localDb)
  })

  afterEach(async () => {
    // Clean up the database
    if (cleanup) {
      await cleanup()
    }
  })

  test('should create a new note with auto-generated UUIDs', async () => {
    const noteData = {
      block_type: 'scribe/markdown',
      body: '# Test Document\n\nThis is a test document.',
      inserter: 'test-user'
    }
    
    const createdNote = await createNote(syncedDb, noteData)
    
    expect(createdNote).toBeDefined()
    expect(createdNote.block_uuid).toBeDefined()
    expect(createdNote.version_uuid).toBeDefined()
    expect(createdNote.block_type).toBe(noteData.block_type)
    expect(createdNote.body).toBe(noteData.body)
    expect(createdNote.inserter).toBe(noteData.inserter)
    expect(createdNote.prior_version_uuid).toBeNull()
    expect(createdNote.insert_datetime).toBeDefined()
  })

  test('should create a new note with specified UUIDs', async () => {
    const blockUuid = uuidv4() as BlockUuid
    
    const noteData = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Test Document\n\nThis is a test document.',
      inserter: 'test-user'
    }
    
    const createdNote = await createNote(syncedDb, noteData)
    
    expect(createdNote).toBeDefined()
    expect(createdNote.block_uuid).toBe(blockUuid)
    expect(createdNote.version_uuid).toBeDefined()
    expect(createdNote.block_type).toBe(noteData.block_type)
    expect(createdNote.body).toBe(noteData.body)
    expect(createdNote.inserter).toBe(noteData.inserter)
    expect(createdNote.prior_version_uuid).toBeNull()
  })

  test('should create a new version of an existing note', async () => {
    // First create an initial note
    const blockUuid = uuidv4() as BlockUuid
    const initialNoteData = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Initial Version\n\nThis is the first version.',
      inserter: 'test-user'
    }
    
    const initialNote = await createNote(syncedDb, initialNoteData)
    
    // Now create a new version
    const newVersionData = {
      block_type: 'scribe/markdown',
      body: '# Updated Version\n\nThis is the updated version.',
      inserter: 'test-user'
    }
    
    const newVersion = await createNoteVersion(syncedDb, blockUuid, newVersionData)
    
    expect(newVersion).toBeDefined()
    expect(newVersion.block_uuid).toBe(blockUuid)
    expect(newVersion.version_uuid).not.toBe(initialNote.version_uuid)
    expect(newVersion.prior_version_uuid).toBe(initialNote.version_uuid)
    expect(newVersion.body).toBe(newVersionData.body)
  })

  test('should retrieve a note by UUID', async () => {
    // Create a note
    const noteData = {
      block_type: 'scribe/markdown',
      body: '# Test Document\n\nThis is a test document.',
      inserter: 'test-user'
    }
    
    const createdNote = await createNote(syncedDb, noteData)
    
    // Retrieve the note
    const retrievedNote = await getNoteByUuid(syncedDb, createdNote.block_uuid)
    
    expect(retrievedNote).toBeDefined()
    expect(retrievedNote?.block_uuid).toBe(createdNote.block_uuid)
    expect(retrievedNote?.body).toBe(createdNote.body)
  })

  test('should retrieve the latest version when multiple versions exist', async () => {
    const blockUuid = uuidv4() as BlockUuid
    
    // Create first version
    const version1 = await createNote(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 1\n\nFirst version.',
      inserter: 'test-user'
    })
    
    // Create second version
    const version2 = await createNote(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 2\n\nSecond version.',
      inserter: 'test-user',
      prior_version_uuid: version1.version_uuid
    })
    
    // Retrieve the note by UUID (should get latest version)
    const retrievedNote = await getNoteByUuid(syncedDb, blockUuid)
    
    expect(retrievedNote).toBeDefined()
    expect(retrievedNote?.version_uuid).toBe(version2.version_uuid)
    expect(retrievedNote?.body).toBe(version2.body)
  })

  test('should return null when retrieving non-existent note', async () => {
    const nonExistentUuid = uuidv4() as BlockUuid
    
    const retrievedNote = await getNoteByUuid(syncedDb, nonExistentUuid)
    
    expect(retrievedNote).toBeNull()
  })

  test('should retrieve all versions of a note', async () => {
    const blockUuid = uuidv4() as BlockUuid
    
    // Create first version
    const version1 = await createNote(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 1\n\nFirst version.',
      inserter: 'test-user'
    })
    
    // Create second version
    const version2 = await createNote(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 2\n\nSecond version.',
      inserter: 'test-user',
      prior_version_uuid: version1.version_uuid
    })
    
    // Retrieve all versions
    const versions = await getNoteVersions(syncedDb, blockUuid)
    
    expect(versions).toHaveLength(2)
    expect(versions[0].version_uuid).toBe(version1.version_uuid)
    expect(versions[1].version_uuid).toBe(version2.version_uuid)
  })

  test('should retrieve latest version of a note', async () => {
    const blockUuid = uuidv4() as BlockUuid
    
    // Create first version
    const version1 = await createNote(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 1\n\nFirst version.',
      inserter: 'test-user'
    })
    
    // Create second version
    const version2 = await createNote(syncedDb, {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      body: '# Version 2\n\nSecond version.',
      inserter: 'test-user',
      prior_version_uuid: version1.version_uuid
    })
    
    // Retrieve latest version
    const latestVersion = await getLatestNoteVersion(syncedDb, blockUuid)
    
    expect(latestVersion).toBeDefined()
    expect(latestVersion?.version_uuid).toBe(version2.version_uuid)
    expect(latestVersion?.body).toBe(version2.body)
  })

  test('should return null when retrieving latest version of non-existent note', async () => {
    const nonExistentUuid = uuidv4() as BlockUuid
    
    const latestVersion = await getLatestNoteVersion(syncedDb, nonExistentUuid)
    
    expect(latestVersion).toBeNull()
  })

  test('should count notes correctly', async () => {
    // Initially should be 0 notes
    let count = await getNoteCount(syncedDb)
    expect(count).toBe(0)

    // Create first note
    const note1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Note 1\n\nFirst note.',
      inserter: 'test-user'
    })
    
    count = await getNoteCount(syncedDb)
    expect(count).toBe(1)

    // Create second note
    const note2 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Note 2\n\nSecond note.',
      inserter: 'test-user'
    })
    
    count = await getNoteCount(syncedDb)
    expect(count).toBe(2)

    // Create a new version of the first note (should still be 2 total notes)
    const version2 = await createNoteVersion(syncedDb, note1.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# Note 1 Updated\n\nFirst note updated.',
      inserter: 'test-user'
    })
    
    count = await getNoteCount(syncedDb)
    expect(count).toBe(3) // 2 unique notes + 1 new version = 3 total rows
  })
})
