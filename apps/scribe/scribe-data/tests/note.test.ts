import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { BlockUuid, VersionUuid } from '../src/types.js'
import { up } from '../src/migrations.js'
import { createTestDB } from './test-utils.js'
import {
  createNote,
  createNoteVersion,
  getNoteByUuid,
  getNoteVersions,
  getLatestNoteVersion,
  getNoteCount,
  getVersionHistory,
  getVersionPosition,
  getVersionTree,
  getVersionByUuid,
  moveNote
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

  test('should create a note with a custom insert_datetime', async () => {
    const customDate = '2024-06-15T12:00:00.000Z'

    const createdNote = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Backdated\n\nA note with a custom timestamp.',
      inserter: 'test-user',
      insert_datetime: customDate
    })

    expect(createdNote.insert_datetime).toBe(customDate)

    const retrieved = await getNoteByUuid(syncedDb, createdNote.block_uuid)
    expect(retrieved).toBeDefined()
    expect(retrieved!.insert_datetime).toBe(customDate)
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

describe('version history', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    cleanup = async () => {}
    await up(syncedDb, localDb)
  })

  afterEach(async () => {
    if (cleanup) await cleanup()
  })

  test('single version', async () => {
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Single Version',
      inserter: 'test-user'
    })

    const history = await getVersionHistory(syncedDb, note.block_uuid)

    expect(history).toHaveLength(1)
    expect(history[0].position).toBe(1)
    expect(history[0].total).toBe(1)
    expect(history[0].isAuthoritative).toBe(true)
    expect(history[0].version_uuid).toBe(note.version_uuid)
    expect(history[0].inserter).toBe('test-user')
  })

  test('multiple versions', async () => {
    const v1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Version 1',
      inserter: 'test-user'
    })

    const v2 = await createNoteVersion(syncedDb, v1.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# Version 2',
      inserter: 'test-user'
    })

    const v3 = await createNoteVersion(syncedDb, v1.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# Version 3',
      inserter: 'test-user'
    })

    const history = await getVersionHistory(syncedDb, v1.block_uuid)

    expect(history).toHaveLength(3)
    expect(history[0]).toMatchObject({ position: 1, total: 3, isAuthoritative: false, version_uuid: v1.version_uuid })
    expect(history[1]).toMatchObject({ position: 2, total: 3, isAuthoritative: false, version_uuid: v2.version_uuid })
    expect(history[2]).toMatchObject({ position: 3, total: 3, isAuthoritative: true, version_uuid: v3.version_uuid })
  })

  test('getVersionPosition hit', async () => {
    const v1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Version 1',
      inserter: 'test-user'
    })

    const v2 = await createNoteVersion(syncedDb, v1.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# Version 2',
      inserter: 'test-user'
    })

    await createNoteVersion(syncedDb, v1.block_uuid, {
      block_type: 'scribe/markdown',
      body: '# Version 3',
      inserter: 'test-user'
    })

    const pos = await getVersionPosition(syncedDb, v1.block_uuid, v2.version_uuid)

    expect(pos).not.toBeNull()
    expect(pos!.position).toBe(2)
    expect(pos!.total).toBe(3)
    expect(pos!.isAuthoritative).toBe(false)
  })

  test('getVersionPosition miss', async () => {
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Some Note',
      inserter: 'test-user'
    })

    const pos = await getVersionPosition(syncedDb, note.block_uuid, uuidv4())

    expect(pos).toBeNull()
  })

  test('empty note', async () => {
    const history = await getVersionHistory(syncedDb, uuidv4())

    expect(history).toEqual([])
  })
})

describe('version tree', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    cleanup = async () => {}
    await up(syncedDb, localDb)
  })

  afterEach(async () => {
    if (cleanup) await cleanup()
  })

  test('linear history', async () => {
    const v1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# V1',
      inserter: 'test-user',
      insert_datetime: '2024-01-01T00:00:00.000Z'
    })

    const v2 = await createNote(syncedDb, {
      block_uuid: v1.block_uuid,
      block_type: 'scribe/markdown',
      body: '# V2',
      inserter: 'test-user',
      prior_version_uuid: v1.version_uuid,
      insert_datetime: '2024-01-02T00:00:00.000Z'
    })

    const v3 = await createNote(syncedDb, {
      block_uuid: v1.block_uuid,
      block_type: 'scribe/markdown',
      body: '# V3',
      inserter: 'test-user',
      prior_version_uuid: v2.version_uuid,
      insert_datetime: '2024-01-03T00:00:00.000Z'
    })

    const nodes = await getVersionTree(syncedDb, v1.block_uuid)

    // Newest first
    expect(nodes).toHaveLength(3)
    expect(nodes[0].version_uuid).toBe(v3.version_uuid)
    expect(nodes[0].prior_version_uuid).toBe(v2.version_uuid)
    expect(nodes[0].isAuthoritative).toBe(true)
    expect(nodes[1].version_uuid).toBe(v2.version_uuid)
    expect(nodes[1].prior_version_uuid).toBe(v1.version_uuid)
    expect(nodes[1].isAuthoritative).toBe(false)
    expect(nodes[2].version_uuid).toBe(v1.version_uuid)
    expect(nodes[2].prior_version_uuid).toBeNull()
    expect(nodes[2].isAuthoritative).toBe(false)
  })

  test('branching history', async () => {
    const v1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# V1',
      inserter: 'test-user',
      insert_datetime: '2024-01-01T00:00:00.000Z'
    })

    const v2 = await createNote(syncedDb, {
      block_uuid: v1.block_uuid,
      block_type: 'scribe/markdown',
      body: '# V2 (branch A)',
      inserter: 'device-a',
      prior_version_uuid: v1.version_uuid,
      insert_datetime: '2024-01-02T00:00:00.000Z'
    })

    const v3 = await createNote(syncedDb, {
      block_uuid: v1.block_uuid,
      block_type: 'scribe/markdown',
      body: '# V3 (branch B)',
      inserter: 'device-b',
      prior_version_uuid: v1.version_uuid,
      insert_datetime: '2024-01-03T00:00:00.000Z'
    })

    const nodes = await getVersionTree(syncedDb, v1.block_uuid)

    expect(nodes).toHaveLength(3)
    // Newest first: v3, v2, v1
    expect(nodes[0].version_uuid).toBe(v3.version_uuid)
    // Both v2 and v3 share the same prior_version_uuid (branch point)
    expect(nodes[0].prior_version_uuid).toBe(v1.version_uuid)
    expect(nodes[1].prior_version_uuid).toBe(v1.version_uuid)
    expect(nodes[2].version_uuid).toBe(v1.version_uuid)
  })

  test('authoritative marking', async () => {
    const v1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# V1',
      inserter: 'test-user',
      insert_datetime: '2024-01-01T00:00:00.000Z'
    })

    const v2 = await createNote(syncedDb, {
      block_uuid: v1.block_uuid,
      block_type: 'scribe/markdown',
      body: '# V2 (early branch)',
      inserter: 'device-a',
      prior_version_uuid: v1.version_uuid,
      insert_datetime: '2024-01-02T00:00:00.000Z'
    })

    const v3 = await createNote(syncedDb, {
      block_uuid: v1.block_uuid,
      block_type: 'scribe/markdown',
      body: '# V3 (late branch)',
      inserter: 'device-b',
      prior_version_uuid: v1.version_uuid,
      insert_datetime: '2024-01-03T00:00:00.000Z'
    })

    const nodes = await getVersionTree(syncedDb, v1.block_uuid)

    // Only the first entry (newest) should be authoritative
    const authNodes = nodes.filter(n => n.isAuthoritative)
    expect(authNodes).toHaveLength(1)
    expect(authNodes[0].version_uuid).toBe(v3.version_uuid)
  })

  test('pagination with offset and limit', async () => {
    const v1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# V1',
      inserter: 'test-user',
      insert_datetime: '2024-01-01T00:00:00.000Z'
    })

    const v2 = await createNote(syncedDb, {
      block_uuid: v1.block_uuid,
      block_type: 'scribe/markdown',
      body: '# V2',
      inserter: 'test-user',
      prior_version_uuid: v1.version_uuid,
      insert_datetime: '2024-01-02T00:00:00.000Z'
    })

    const v3 = await createNote(syncedDb, {
      block_uuid: v1.block_uuid,
      block_type: 'scribe/markdown',
      body: '# V3',
      inserter: 'test-user',
      prior_version_uuid: v2.version_uuid,
      insert_datetime: '2024-01-03T00:00:00.000Z'
    })

    // First page: newest 2 versions (v3, v2)
    const page1 = await getVersionTree(syncedDb, v1.block_uuid, 2, 0)
    expect(page1).toHaveLength(2)
    expect(page1[0].version_uuid).toBe(v3.version_uuid)
    expect(page1[0].isAuthoritative).toBe(true)
    expect(page1[1].version_uuid).toBe(v2.version_uuid)
    expect(page1[1].isAuthoritative).toBe(false)

    // Second page: oldest version (v1)
    const page2 = await getVersionTree(syncedDb, v1.block_uuid, 2, 2)
    expect(page2).toHaveLength(1)
    expect(page2[0].version_uuid).toBe(v1.version_uuid)
    expect(page2[0].isAuthoritative).toBe(false)
  })

  test('no authoritative marking on non-first page', async () => {
    const v1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# V1',
      inserter: 'test-user',
      insert_datetime: '2024-01-01T00:00:00.000Z'
    })

    await createNote(syncedDb, {
      block_uuid: v1.block_uuid,
      block_type: 'scribe/markdown',
      body: '# V2',
      inserter: 'test-user',
      prior_version_uuid: v1.version_uuid,
      insert_datetime: '2024-01-02T00:00:00.000Z'
    })

    await createNote(syncedDb, {
      block_uuid: v1.block_uuid,
      block_type: 'scribe/markdown',
      body: '# V3',
      inserter: 'test-user',
      prior_version_uuid: v1.version_uuid,
      insert_datetime: '2024-01-03T00:00:00.000Z'
    })

    // Second page — no node should be authoritative
    const page = await getVersionTree(syncedDb, v1.block_uuid, 2, 2)
    expect(page).toHaveLength(1)
    expect(page.every(n => !n.isAuthoritative)).toBe(true)
  })

  test('getVersionByUuid hit', async () => {
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Target Version',
      inserter: 'test-user'
    })

    const result = await getVersionByUuid(syncedDb, note.version_uuid)

    expect(result).not.toBeNull()
    expect(result!.version_uuid).toBe(note.version_uuid)
    expect(result!.block_uuid).toBe(note.block_uuid)
    expect(result!.body).toBe('# Target Version')
  })

  test('getVersionByUuid miss', async () => {
    const result = await getVersionByUuid(syncedDb, uuidv4())

    expect(result).toBeNull()
  })

  test('empty note returns empty array', async () => {
    const nodes = await getVersionTree(syncedDb, uuidv4())

    expect(nodes).toEqual([])
  })

  describe('Note Slug', () => {
    test('note creation sets slug from H1 title', async () => {
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# My Recipe Title\n\nSome content here.',
        inserter: 'test-user'
      })

      expect(note.slug).toBe('my-recipe-title')
    })

    test('note creation falls back to block_uuid when no title', async () => {
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: 'No heading here, just plain text.',
        inserter: 'test-user'
      })

      expect(note.slug).toBe(note.block_uuid)
    })

    test('note creation accepts explicit slug override', async () => {
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# My Recipe Title\n\nSome content here.',
        inserter: 'test-user',
        slug: 'custom-slug'
      })

      expect(note.slug).toBe('custom-slug')
    })

    test('createNoteVersion carries forward slug', async () => {
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Original Title\n\nOriginal content.',
        inserter: 'test-user'
      })

      expect(note.slug).toBe('original-title')

      const v2 = await createNoteVersion(syncedDb, note.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Different Title\n\nUpdated content.',
        inserter: 'test-user'
      })

      // Slug should be carried forward from v1, not re-derived
      expect(v2.slug).toBe('original-title')
    })

    test('createNoteVersion accepts slug override', async () => {
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Original Title\n\nOriginal content.',
        inserter: 'test-user'
      })

      const v2 = await createNoteVersion(syncedDb, note.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Updated Title\n\nUpdated content.',
        inserter: 'test-user',
        slug: 'renamed-slug'
      })

      expect(v2.slug).toBe('renamed-slug')
    })

    test('moveNote preserves slug', async () => {
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# My Note\n\nContent.',
        inserter: 'test-user',
        collection_id: null
      })

      expect(note.slug).toBe('my-note')

      const moved = await moveNote(syncedDb, note.block_uuid, 'some-collection-id', 'test-user')

      expect(moved.slug).toBe('my-note')
      expect(moved.collection_id).toBe('some-collection-id')
    })
  })
})
