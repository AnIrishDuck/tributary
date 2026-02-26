import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { up } from '../src/migrations.js'
import {
  indexSlugs,
  indexAll,
  indexCollectionSlugs,
  extractTitleFromMarkdown,
  titleToSlug,
  slugToTitle,
  extractTagsFromMarkdown,
  getNoteSlugByUuid,
  getAuthoritativeVersionByNoteUuid,
  getTagsForNote,
  getAllNotesWithTitles,
  getLastEditedTime,
  getNotesInCollectionWithSlugs,
  IndexSlugsResult
} from '../src/indexing.js'
import { searchNotes } from '../src/search.js'
import { createTestDB } from './test-utils.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'
import { createNote, createNoteVersion } from '../src/note.js'
import { createCollection, getCollectionsBySlug } from '../src/collection.js'

describe('scribe-data indexing', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    // Create a fresh test database for each test
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    cleanup = async () => {
      // Cleanup is handled by the test framework
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

  test('should extract title from markdown correctly', () => {
    const testCases = [
      { input: '# My Document Title\n\nThis is the content.', expected: 'My Document Title' },
      { input: '  #   My Document Title   \n\nThis is the content.', expected: 'My Document Title' },
      { input: '## My Document Title\n\nThis is the content.', expected: null },
      { input: '', expected: null },
      { input: '# First Title\n\nContent\n\n# Second Title\n\nMore content.', expected: 'First Title' }
    ]
    
    for (const testCase of testCases) {
      const result = extractTitleFromMarkdown(testCase.input)
      expect(result).toBe(testCase.expected)
    }
  })

  test('should convert title to slug correctly', () => {
    const testCases = [
      { input: 'My Document Title', expected: 'my-document-title' },
      { input: '  My Document Title  ', expected: 'my-document-title' },
      { input: 'My Document!!! Title???', expected: 'my-document-title' },
      { input: 'My-----Document----Title', expected: 'my-document-title' },
      { input: '123 Numbers and Symbols!@#', expected: '123-numbers-and-symbols' }
    ]
    
    for (const testCase of testCases) {
      const result = titleToSlug(testCase.input)
      expect(result).toBe(testCase.expected)
    }
  })

  test('should convert slug back to title correctly', () => {
    const testCases = [
      { input: 'my-document-title', expected: 'My Document Title' },
      { input: 'single', expected: 'Single' },
      { input: 'a-b-c', expected: 'A B C' },
      { input: '123-numbers-and-symbols', expected: '123 Numbers And Symbols' },
      { input: 'already', expected: 'Already' },
    ]

    for (const testCase of testCases) {
      const result = slugToTitle(testCase.input)
      expect(result).toBe(testCase.expected)
    }
  })

  test('slugToTitle is the inverse of titleToSlug for simple titles', () => {
    const titles = ['My Document', 'Hello World', 'Italian Recipes']
    for (const title of titles) {
      expect(slugToTitle(titleToSlug(title))).toBe(title)
    }
  })

  test('should extract tags from markdown correctly', () => {
    const testCases = [
      { input: 'This is a document with [#tag1](#tag1) and [#tag2](#tag2).', expected: ['tag1', 'tag2'] },
      { input: 'This document has no tags.', expected: [] },
      { input: '[#invalid](different)', expected: [] },
      { input: '[#tag1](#tag1) and [#tag1](#tag1) duplicates', expected: ['tag1'] }
    ]
    
    for (const testCase of testCases) {
      const result = extractTagsFromMarkdown(testCase.input).sort()
      const expected = testCase.expected.sort()
      expect(result).toEqual(expected)
    }
  })

  test('should index slugs for new notes', async () => {
    // Insert a note with a title using the note functions
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# My Test Document\n\nThis is a test document with a title.',
      inserter: 'test-user'
    })
    
    const blockUuid = note.block_uuid
    const versionUuid = note.version_uuid
    
    // Run indexing
    const result: IndexSlugsResult = await indexSlugs(localDb)
    
    expect(result.indexedCount).toBe(1)
    expect(result.hasMore).toBe(false)
    
    // Check that the note was marked as indexed by checking authoritative version
    const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, blockUuid)
    
    expect(authoritativeVersion).toBeDefined()
    expect(authoritativeVersion?.version_uuid).toBe(versionUuid)
    
    // Check that the slug was created
    const slug = await getNoteSlugByUuid(localDb, blockUuid)
    
    expect(slug).toBeDefined()
    expect(slug?.slug).toBe('my-test-document')
    expect(slug?.title).toBe('My Test Document')
  })

  test('should handle notes without titles', async () => {
    // Insert a note without a title using the note functions
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: 'This is a document without a title.',
      inserter: 'test-user'
    })
    
    const blockUuid = note.block_uuid
    const versionUuid = note.version_uuid
    
    // Run indexing
    const result: IndexSlugsResult = await indexSlugs(localDb)
    
    expect(result.indexedCount).toBe(0) // No slug to index
    expect(result.hasMore).toBe(false)
    
    // Check that the note was still marked as indexed by checking authoritative version
    const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, blockUuid)
    
    expect(authoritativeVersion).toBeDefined()
    expect(authoritativeVersion?.version_uuid).toBe(versionUuid)
    
    // Check that no slug was created
    const slug = await getNoteSlugByUuid(localDb, blockUuid)
    
    expect(slug).toBeNull()
  })

  test('should update slug when note version changes', async () => {
    // Insert first version with one title using the note functions
    const noteV1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Original Title\n\nThis is the first version.',
      inserter: 'test-user'
    })
    
    const blockUuid = noteV1.block_uuid
    const version1Uuid = noteV1.version_uuid
    
    // Run indexing on first version
    await indexSlugs(localDb)
    
    // Check initial slug
    const initialSlug = await getNoteSlugByUuid(localDb, blockUuid)
    
    expect(initialSlug).toBeDefined()
    expect(initialSlug?.slug).toBe('original-title')
    expect(initialSlug?.title).toBe('Original Title')
    
    // Insert second version with updated title using the note functions
    const noteV2 = await createNoteVersion(syncedDb, blockUuid, {
      block_type: 'scribe/markdown',
      body: '# Updated Title\n\nThis is the updated version.',
      inserter: 'test-user'
    })
    
    const version2Uuid = noteV2.version_uuid
    
    // Run indexing again
    const result: IndexSlugsResult = await indexSlugs(localDb)
    
    expect(result.indexedCount).toBe(1)
    expect(result.hasMore).toBe(false)
    
    // Check updated slug
    const updatedSlug = await getNoteSlugByUuid(localDb, blockUuid)
    
    expect(updatedSlug).toBeDefined()
    expect(updatedSlug?.slug).toBe('updated-title')
    expect(updatedSlug?.title).toBe('Updated Title')
    
    // Check that the authoritative version was updated
    const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, blockUuid)
    
    expect(authoritativeVersion?.version_uuid).toBe(version2Uuid)
  })

  test('should respect indexing limit', async () => {
    // Insert multiple notes using the note functions
    const notes = []
    for (let i = 0; i < 5; i++) {
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: `# Document ${i}\n\nThis is document number ${i}.`,
        inserter: 'test-user'
      })
      notes.push(note)
    }
    
    // Run indexing with limit of 3
    const result: IndexSlugsResult = await indexSlugs(localDb, { limit: 3 })
    
    expect(result.indexedCount).toBe(3)
    expect(result.hasMore).toBe(true) // Should have more since we have 5 total
    
    // Run indexing again to get the rest
    const result2: IndexSlugsResult = await indexSlugs(localDb, { limit: 3 })
    
    expect(result2.indexedCount).toBe(2) // Remaining 2
    expect(result2.hasMore).toBe(false)
  })

  test('should allow duplicate slugs for notes with the same title', async () => {
    // Insert two notes with the same title using the note functions
    const note1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Same Title\n\nThis is the first document with this title.',
      inserter: 'test-user'
    })

    const note1Uuid = note1.block_uuid

    const note2 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Same Title\n\nThis is the second document with this title.',
      inserter: 'test-user'
    })

    const note2Uuid = note2.block_uuid

    // Run indexing
    await indexSlugs(localDb)

    // Get both slugs
    const slug1 = await getNoteSlugByUuid(localDb, note1Uuid)
    const slug2 = await getNoteSlugByUuid(localDb, note2Uuid)

    expect(slug1).toBeDefined()
    expect(slug2).toBeDefined()

    // Both should have the same title
    expect(slug1?.title).toBe('Same Title')
    expect(slug2?.title).toBe('Same Title')

    // Both should have the same slug (duplicates are allowed)
    expect(slug1?.slug).toBe('same-title')
    expect(slug2?.slug).toBe('same-title')
  })

  test('should index tags for new notes', async () => {
    // Insert a note with tags using the note functions
    const note = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# My Document with Tags\n\nThis document has [#important](#important) and [#work](#work) tags.',
      inserter: 'test-user'
    })
    
    const blockUuid = note.block_uuid
    const versionUuid = note.version_uuid
    
    // Run indexing
    await indexSlugs(localDb)
    
    // Check that tags were indexed
    const tags = await getTagsForNote(localDb, blockUuid)
    
    expect(tags).toHaveLength(2)
    expect(tags).toContain('important')
    expect(tags).toContain('work')
  })

  test('should add tags to an authoritative version of a note', async () => {
    // Insert first version without tags using the note functions
    const noteV1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document has no tags initially.',
      inserter: 'test-user'
    })
    
    const blockUuid = noteV1.block_uuid
    const version1Uuid = noteV1.version_uuid
    
    // Run indexing on first version
    await indexSlugs(localDb)
    
    // Check that no tags exist
    let tags = await getTagsForNote(localDb, blockUuid)
    
    expect(tags).toHaveLength(0)
    
    // Insert second version with tags using the note functions
    const noteV2 = await createNoteVersion(syncedDb, blockUuid, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document now has [#newtag](#newtag) and [#anothertag](#anothertag) tags.',
      inserter: 'test-user'
    })
    
    const version2Uuid = noteV2.version_uuid
    
    // Run indexing again
    await indexSlugs(localDb)
    
    // Check that tags were added
    tags = await getTagsForNote(localDb, blockUuid)
    
    expect(tags).toHaveLength(2)
    expect(tags).toContain('newtag')
    expect(tags).toContain('anothertag')
  })

  test('should remove tags from an authoritative version of a note', async () => {
    // Insert first version with tags using the note functions
    const noteV1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document has [#tag1](#tag1) and [#tag2](#tag2) tags.',
      inserter: 'test-user'
    })
    
    const blockUuid = noteV1.block_uuid
    const version1Uuid = noteV1.version_uuid
    
    // Run indexing on first version
    await indexSlugs(localDb)
    
    // Check that tags exist
    let tags = await getTagsForNote(localDb, blockUuid)
    
    expect(tags).toHaveLength(2)
    expect(tags).toContain('tag1')
    expect(tags).toContain('tag2')
    
    // Insert second version with fewer tags using the note functions
    const noteV2 = await createNoteVersion(syncedDb, blockUuid, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document now only has [#tag1](#tag1) tag.',
      inserter: 'test-user'
    })
    
    const version2Uuid = noteV2.version_uuid
    
    // Run indexing again
    await indexSlugs(localDb)
    
    // Check that only remaining tag exists
    tags = await getTagsForNote(localDb, blockUuid)
    
    expect(tags).toHaveLength(1)
    expect(tags).toContain('tag1')
  })

  test('should change tags in an authoritative version of a note', async () => {
    // Insert first version with some tags using the note functions
    const noteV1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document has [#oldtag](#oldtag) tag.',
      inserter: 'test-user'
    })
    
    const blockUuid = noteV1.block_uuid
    const version1Uuid = noteV1.version_uuid
    
    // Run indexing on first version
    await indexSlugs(localDb)
    
    // Check that old tag exists
    let tags = await getTagsForNote(localDb, blockUuid)
    
    expect(tags).toHaveLength(1)
    expect(tags).toContain('oldtag')
    
    // Insert second version with different tags using the note functions
    const noteV2 = await createNoteVersion(syncedDb, blockUuid, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document now has [#newtag](#newtag) and [#different](#different) tags.',
      inserter: 'test-user'
    })
    
    const version2Uuid = noteV2.version_uuid
    
    // Run indexing again
    await indexSlugs(localDb)
    
    // Check that new tags exist and old ones are removed
    tags = await getTagsForNote(localDb, blockUuid)
    
    expect(tags).toHaveLength(2)
    expect(tags).toContain('newtag')
    expect(tags).toContain('different')
  })

  test('should index both slugs and search vectors with indexAll', async () => {
    // Create test notes
    const note1 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# JavaScript Tutorial\n\nLearn JavaScript basics.',
      inserter: 'test-user'
    })

    const note2 = await createNote(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Python Guide\n\nPython programming essentials.',
      inserter: 'test-user'
    })

    // Run indexAll
    const result = await indexAll(localDb)

    expect(result.indexedCount).toBe(2)
    expect(result.hasMore).toBe(false)

    // Verify slugs were created
    const slug1 = await getNoteSlugByUuid(localDb, note1.block_uuid)
    expect(slug1?.slug).toBe('javascript-tutorial')

    // Verify search vectors were created
    const searchResults = await searchNotes(localDb, 'JavaScript')
    expect(searchResults).toHaveLength(1)
    expect(searchResults[0].block_uuid).toBe(note1.block_uuid)
  })

  describe('getAllNotesWithTitles', () => {
    test('should return notes sorted by insert_datetime in descending order (most recent first)', async () => {
      // Create notes with a delay between them to ensure different insert_datetime
      const note1 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# First Document\n\nThis is the first document.',
        inserter: 'test-user'
      })

      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 50))

      const note2 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Second Document\n\nThis is the second document.',
        inserter: 'test-user'
      })

      await new Promise(resolve => setTimeout(resolve, 50))

      const note3 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Third Document\n\nThis is the third document.',
        inserter: 'test-user'
      })

      // Index the notes
      await indexSlugs(localDb)

      // Get all notes with titles
      const notes = await getAllNotesWithTitles(localDb)

      expect(notes).toHaveLength(3)

      // Verify they are sorted by insert_datetime DESC (most recent first)
      expect(notes[0].title).toBe('Third Document')
      expect(notes[1].title).toBe('Second Document')
      expect(notes[2].title).toBe('First Document')
    })

    test('should return insert_datetime for each note', async () => {
      const now = new Date()

      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Test Document\n\nThis is a test.',
        inserter: 'test-user'
      })

      // Index the note
      await indexSlugs(localDb)

      // Get all notes with titles
      const notes = await getAllNotesWithTitles(localDb)

      expect(notes).toHaveLength(1)
      expect(notes[0].title).toBe('Test Document')

      // Verify insert_datetime is present and is a valid ISO date string
      expect(notes[0].insert_datetime).toBeDefined()
      const insertDate = new Date(notes[0].insert_datetime)
      expect(insertDate.getTime()).not.toBeNaN()

      // The insert_datetime should be recent (within the last minute)
      const oneMinuteAgo = new Date(now.getTime() - 60000)
      expect(insertDate.getTime()).toBeGreaterThan(oneMinuteAgo.getTime())
    })

    test('should return indexed_at for each note', async () => {
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Test Document\n\nThis is a test.',
        inserter: 'test-user'
      })

      // Index the note
      await indexSlugs(localDb)

      // Get all notes with titles
      const notes = await getAllNotesWithTitles(localDb)

      expect(notes).toHaveLength(1)

      // Verify indexed_at is present and is a valid ISO date string
      expect(notes[0].indexed_at).toBeDefined()
      const indexedDate = new Date(notes[0].indexed_at)
      expect(indexedDate.getTime()).not.toBeNaN()
    })

    test('should sort notes by most recent edit after updating a note', async () => {
      // Create initial notes
      const note1 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# First Document\n\nOriginal content.',
        inserter: 'test-user'
      })

      await new Promise(resolve => setTimeout(resolve, 50))

      const note2 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Second Document\n\nOriginal content.',
        inserter: 'test-user'
      })

      // Index both notes
      await indexSlugs(localDb)

      // Verify initial sort order (note2 should be first since it's newer)
      let notes = await getAllNotesWithTitles(localDb)
      expect(notes[0].title).toBe('Second Document')
      expect(notes[1].title).toBe('First Document')

      // Wait a bit, then update note1 (which is older)
      await new Promise(resolve => setTimeout(resolve, 50))

      await createNoteVersion(syncedDb, note1.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# First Document Updated\n\nUpdated content.',
        inserter: 'test-user'
      })

      // Re-index
      await indexSlugs(localDb)

      // Verify new sort order (note1 should now be first since it was edited most recently)
      notes = await getAllNotesWithTitles(localDb)
      expect(notes[0].title).toBe('First Document Updated')
      expect(notes[1].title).toBe('Second Document')
    })
  })

  describe('getLastEditedTime', () => {
    test('should return null when there are no notes', async () => {
      const lastEdited = await getLastEditedTime(localDb)
      expect(lastEdited).toBeNull()
    })

    test('should return the insert_datetime of a single note', async () => {
      const beforeCreate = new Date()

      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Test Document\n\nThis is a test.',
        inserter: 'test-user'
      })

      const lastEdited = await getLastEditedTime(localDb)

      expect(lastEdited).not.toBeNull()
      const lastEditedDate = new Date(lastEdited!)
      expect(lastEditedDate.getTime()).not.toBeNaN()

      // The last edited time should be after the beforeCreate time
      expect(lastEditedDate.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
    })

    test('should return the most recent insert_datetime when there are multiple notes', async () => {
      const note1 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# First Document\n\nFirst content.',
        inserter: 'test-user'
      })

      await new Promise(resolve => setTimeout(resolve, 50))

      const note2 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Second Document\n\nSecond content.',
        inserter: 'test-user'
      })

      const lastEdited = await getLastEditedTime(localDb)

      expect(lastEdited).not.toBeNull()
      const lastEditedDate = new Date(lastEdited!)

      // The last edited time should match the second note's insert_datetime
      expect(lastEditedDate.getTime()).toBe(new Date(note2.insert_datetime).getTime())
    })

    test('should update when a new version is created', async () => {
      const note1 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# First Document\n\nFirst content.',
        inserter: 'test-user'
      })

      const initialLastEdited = await getLastEditedTime(localDb)

      await new Promise(resolve => setTimeout(resolve, 50))

      // Create a new version of the same note
      const noteV2 = await createNoteVersion(syncedDb, note1.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# First Document Updated\n\nUpdated content.',
        inserter: 'test-user'
      })

      const updatedLastEdited = await getLastEditedTime(localDb)

      expect(updatedLastEdited).not.toBeNull()
      expect(new Date(updatedLastEdited!).getTime()).toBeGreaterThan(
        new Date(initialLastEdited!).getTime()
      )

      // The updated last edited time should match the new version's insert_datetime
      expect(new Date(updatedLastEdited!).getTime()).toBe(new Date(noteV2.insert_datetime).getTime())
    })
  })

  describe('collection slug indexing', () => {
    test('indexCollectionSlugs generates correct slugs from titles', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Italian Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Travel Notes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await indexCollectionSlugs(localDb)

      const italianResults = await getCollectionsBySlug(localDb, 'italian-recipes')
      expect(italianResults).toHaveLength(1)
      expect(italianResults[0].title).toBe('Italian Recipes')

      const travelResults = await getCollectionsBySlug(localDb, 'travel-notes')
      expect(travelResults).toHaveLength(1)
      expect(travelResults[0].title).toBe('Travel Notes')
    })

    test('indexCollectionSlugs does not index the root collection', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      await indexCollectionSlugs(localDb)

      const results = await getCollectionsBySlug(localDb, 'my-library')
      expect(results).toHaveLength(0)
    })

    test('getCollectionsBySlug returns all matching collections', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await indexCollectionSlugs(localDb)

      const results = await getCollectionsBySlug(localDb, 'recipes')
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Recipes')

      // Non-existent slug returns empty array
      const noResults = await getCollectionsBySlug(localDb, 'nonexistent')
      expect(noResults).toHaveLength(0)
    })

    test('collection_slug table is created by migration', async () => {
      // The up() migration was called in beforeEach, so the table should exist
      // Verify by querying it (should not throw)
      const result = await localDb.query('SELECT * FROM collection_slug', [])
      expect(result.rows).toBeDefined()
      expect(result.rows).toHaveLength(0)
    })

    test('indexAll indexes collection slugs alongside note slugs', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      await createCollection(syncedDb, {
        title: 'Project Notes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Test Note\n\nContent.',
        inserter: 'test-user'
      })

      // indexAll should index both note slugs and collection slugs
      await indexAll(localDb)

      const collectionResults = await getCollectionsBySlug(localDb, 'project-notes')
      expect(collectionResults).toHaveLength(1)

      const noteSlug = await getNoteSlugByUuid(localDb, (await getAllNotesWithTitles(localDb))[0].block_uuid)
      expect(noteSlug).toBeDefined()
    })

    test('indexCollectionSlugs stores parent_collection_uuid', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const child = await createCollection(syncedDb, {
        title: 'Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      const grandchild = await createCollection(syncedDb, {
        title: 'Italian',
        parent_collection_uuid: child.collection_uuid,
        inserter: 'test-user'
      })

      await indexCollectionSlugs(localDb)

      // Check that parent_collection_uuid is stored in collection_slug rows
      const result = await localDb.query(
        `SELECT * FROM collection_slug WHERE collection_uuid = $1`,
        [child.collection_uuid]
      )
      expect(result.rows).toHaveLength(1)
      expect((result.rows![0] as any).parent_collection_uuid).toBe(root.collection_uuid)

      const grandchildResult = await localDb.query(
        `SELECT * FROM collection_slug WHERE collection_uuid = $1`,
        [grandchild.collection_uuid]
      )
      expect(grandchildResult.rows).toHaveLength(1)
      expect((grandchildResult.rows![0] as any).parent_collection_uuid).toBe(child.collection_uuid)
    })

    test('getAllNotesWithTitles includes collection_id', async () => {
      const root = await createCollection(syncedDb, {
        title: 'My Library',
        inserter: 'test-user'
      })

      const child = await createCollection(syncedDb, {
        title: 'Recipes',
        parent_collection_uuid: root.collection_uuid,
        inserter: 'test-user'
      })

      // Create a note in a collection
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Pasta\n\nPasta recipe.',
        inserter: 'test-user',
        collection_id: child.collection_uuid
      })

      // Create a root-level note
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Free Note\n\nNot in any collection.',
        inserter: 'test-user'
      })

      await indexAll(localDb)

      const allNotes = await getAllNotesWithTitles(localDb)
      expect(allNotes).toHaveLength(2)

      const pastaNote = allNotes.find(n => n.title === 'Pasta')
      expect(pastaNote).toBeDefined()
      expect(pastaNote!.collection_id).toBe(child.collection_uuid)

      const freeNote = allNotes.find(n => n.title === 'Free Note')
      expect(freeNote).toBeDefined()
      expect(freeNote!.collection_id).toBeNull()
    })
  })
})
