import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { Kysely } from 'kysely'
import { v4 as uuidv4 } from 'uuid'
import { up } from '../src/migrations.js'
import { 
  indexSlugs, 
  extractTitleFromMarkdown, 
  titleToSlug, 
  extractTagsFromMarkdown,
  IndexSlugsResult
} from '../src/indexing.js'
import { createTestDB } from './test-utils.js'
import { NewBlockRecord } from '../src/types.js'

describe('scribe-data indexing', () => {
  let db: Kysely<any>
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    // Create a fresh test database for each test
    const result = await createTestDB()
    db = result.db
    cleanup = async () => {
      await db.destroy()
    }
    
    // Run the migration
    await up(db)
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

  test('should index slugs for new blocks', async () => {
    const now = new Date()
    const blockUuid = uuidv4()
    const versionUuid = uuidv4()
    
    // Insert a block with a title
    const block: NewBlockRecord = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      version_uuid: versionUuid,
      prior_version_uuid: null,
      insert_datetime: now.toISOString(),
      inserter: 'test-user',
      body: '# My Test Document\n\nThis is a test document with a title.'
    }
    
    await db.insertInto('block').values(block).execute()
    
    // Run indexing
    const result: IndexSlugsResult = await indexSlugs(db)
    
    expect(result.indexedCount).toBe(1)
    expect(result.hasMore).toBe(false)
    
    // Check that the block was marked as indexed
    const indexedBlock = await db.selectFrom('indexed_block')
      .selectAll()
      .where('block_uuid', '=', blockUuid)
      .executeTakeFirst()
    
    expect(indexedBlock).toBeDefined()
    expect(indexedBlock?.version_uuid).toBe(versionUuid)
    expect(indexedBlock?.indexed).toBe(true)
    
    // Check that the slug was created
    const slug = await db.selectFrom('block_slug')
      .selectAll()
      .where('block_uuid', '=', blockUuid)
      .executeTakeFirst()
    
    expect(slug).toBeDefined()
    expect(slug?.slug).toBe('my-test-document')
    expect(slug?.title).toBe('My Test Document')
  })

  test('should handle blocks without titles', async () => {
    const now = new Date()
    const blockUuid = uuidv4()
    const versionUuid = uuidv4()
    
    // Insert a block without a title
    const block: NewBlockRecord = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      version_uuid: versionUuid,
      prior_version_uuid: null,
      insert_datetime: now.toISOString(),
      inserter: 'test-user',
      body: 'This is a document without a title.'
    }
    
    await db.insertInto('block').values(block).execute()
    
    // Run indexing
    const result: IndexSlugsResult = await indexSlugs(db)
    
    expect(result.indexedCount).toBe(0) // No slug to index
    expect(result.hasMore).toBe(false)
    
    // Check that the block was still marked as indexed
    const indexedBlock = await db.selectFrom('indexed_block')
      .selectAll()
      .where('block_uuid', '=', blockUuid)
      .executeTakeFirst()
    
    expect(indexedBlock).toBeDefined()
    expect(indexedBlock?.version_uuid).toBe(versionUuid)
    expect(indexedBlock?.indexed).toBe(true)
    
    // Check that no slug was created
    const slug = await db.selectFrom('block_slug')
      .selectAll()
      .where('block_uuid', '=', blockUuid)
      .executeTakeFirst()
    
    expect(slug).toBeUndefined()
  })

  test('should update slug when block version changes', async () => {
    const now = new Date()
    const blockUuid = uuidv4()
    const version1Uuid = uuidv4()
    const version2Uuid = uuidv4()
    
    // Insert first version with one title
    const blockV1: NewBlockRecord = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      version_uuid: version1Uuid,
      prior_version_uuid: null,
      insert_datetime: now.toISOString(),
      inserter: 'test-user',
      body: '# Original Title\n\nThis is the first version.'
    }
    
    await db.insertInto('block').values(blockV1).execute()
    
    // Run indexing on first version
    await indexSlugs(db)
    
    // Check initial slug
    const initialSlug = await db.selectFrom('block_slug')
      .selectAll()
      .where('block_uuid', '=', blockUuid)
      .executeTakeFirst()
    
    expect(initialSlug).toBeDefined()
    expect(initialSlug?.slug).toBe('original-title')
    expect(initialSlug?.title).toBe('Original Title')
    
    // Insert second version with updated title
    const blockV2: NewBlockRecord = {
      block_uuid: blockUuid,
      block_type: 'scribe/markdown',
      version_uuid: version2Uuid,
      prior_version_uuid: version1Uuid,
      insert_datetime: new Date(now.getTime() + 1000).toISOString(),
      inserter: 'test-user',
      body: '# Updated Title\n\nThis is the updated version.'
    }
    
    await db.insertInto('block').values(blockV2).execute()
    
    // Run indexing again
    const result: IndexSlugsResult = await indexSlugs(db)
    
    expect(result.indexedCount).toBe(1)
    expect(result.hasMore).toBe(false)
    
    // Check updated slug
    const updatedSlug = await db.selectFrom('block_slug')
      .selectAll()
      .where('block_uuid', '=', blockUuid)
      .executeTakeFirst()
    
    expect(updatedSlug).toBeDefined()
    expect(updatedSlug?.slug).toBe('updated-title')
    expect(updatedSlug?.title).toBe('Updated Title')
    
    // Check that the indexed_block record was updated
    const indexedBlock = await db.selectFrom('indexed_block')
      .selectAll()
      .where('block_uuid', '=', blockUuid)
      .executeTakeFirst()
    
    expect(indexedBlock?.version_uuid).toBe(version2Uuid)
  })

  test('should respect indexing limit', async () => {
    const now = new Date()
    
    // Insert multiple blocks
    for (let i = 0; i < 5; i++) {
      const block: NewBlockRecord = {
        block_uuid: uuidv4(),
        block_type: 'scribe/markdown',
        version_uuid: uuidv4(),
        prior_version_uuid: null,
        insert_datetime: new Date(now.getTime() + i * 1000).toISOString(),
        inserter: 'test-user',
        body: `# Document ${i}\n\nThis is document number ${i}.`
      }
      
      await db.insertInto('block').values(block).execute()
    }
    
    // Run indexing with limit of 3
    const result: IndexSlugsResult = await indexSlugs(db, { limit: 3 })
    
    expect(result.indexedCount).toBe(3)
    expect(result.hasMore).toBe(true) // Should have more since we have 5 total
    
    // Run indexing again to get the rest
    const result2: IndexSlugsResult = await indexSlugs(db, { limit: 3 })
    
    expect(result2.indexedCount).toBe(2) // Remaining 2
    expect(result2.hasMore).toBe(false)
  })

  test('should generate unique slugs with UUID prefixes for duplicate titles', async () => {
    const now = new Date()
    const block1Uuid = uuidv4()
    const block2Uuid = uuidv4()
    const version1Uuid = uuidv4()
    const version2Uuid = uuidv4()
    
    // Insert two blocks with the same title
    const block1: NewBlockRecord = {
      block_uuid: block1Uuid,
      block_type: 'scribe/markdown',
      version_uuid: version1Uuid,
      prior_version_uuid: null,
      insert_datetime: now.toISOString(),
      inserter: 'test-user',
      body: '# Same Title\n\nThis is the first document with this title.'
    }
    
    const block2: NewBlockRecord = {
      block_uuid: block2Uuid,
      block_type: 'scribe/markdown',
      version_uuid: version2Uuid,
      prior_version_uuid: null,
      insert_datetime: new Date(now.getTime() + 1000).toISOString(),
      inserter: 'test-user',
      body: '# Same Title\n\nThis is the second document with this title.'
    }
    
    await db.insertInto('block').values(block1).execute()
    await db.insertInto('block').values(block2).execute()
    
    // Run indexing
    await indexSlugs(db)
    
    // Get both slugs
    const slug1 = await db.selectFrom('block_slug')
      .selectAll()
      .where('block_uuid', '=', block1Uuid)
      .executeTakeFirst()
    
    const slug2 = await db.selectFrom('block_slug')
      .selectAll()
      .where('block_uuid', '=', block2Uuid)
      .executeTakeFirst()
    
    expect(slug1).toBeDefined()
    expect(slug2).toBeDefined()
    
    // Both should have the same base slug but with different UUID prefixes
    expect(slug1?.title).toBe('Same Title')
    expect(slug2?.title).toBe('Same Title')
    
    // Both slugs should be unique
    expect(slug1?.slug).not.toBe(slug2?.slug)
    
    // Both should contain the base slug
    expect(slug1?.slug).toContain('same-title')
    expect(slug2?.slug).toContain('same-title')
    
    // Both should have UUID prefixes
    expect(slug1?.slug).toMatch(/^[a-f0-9]{4}-.+/)
    expect(slug2?.slug).toMatch(/^[a-f0-9]{4}-.+/)
  })
})
