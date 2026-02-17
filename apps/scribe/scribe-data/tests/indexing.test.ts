import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { up } from '../src/migrations.js'
import { 
  indexSlugs,
  indexAll,
  extractTitleFromMarkdown, 
  titleToSlug, 
  extractTagsFromMarkdown,
  getBlockSlugByUuid,
  getAuthoritativeVersionByBlockUuid,
  getTagsForBlock,
  IndexSlugsResult
} from '../src/indexing.js'
import { searchBlocks } from '../src/search.js'
import { createTestDB } from './test-utils.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'
import { createBlock, createBlockVersion } from '../src/block.js'

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
    // Insert a block with a title using the block functions
    const block = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# My Test Document\n\nThis is a test document with a title.',
      inserter: 'test-user'
    })
    
    const blockUuid = block.block_uuid
    const versionUuid = block.version_uuid
    
    // Run indexing
    const result: IndexSlugsResult = await indexSlugs(localDb)
    
    expect(result.indexedCount).toBe(1)
    expect(result.hasMore).toBe(false)
    
    // Check that the block was marked as indexed by checking authoritative version
    const authoritativeVersion = await getAuthoritativeVersionByBlockUuid(localDb, blockUuid)
    
    expect(authoritativeVersion).toBeDefined()
    expect(authoritativeVersion?.version_uuid).toBe(versionUuid)
    
    // Check that the slug was created
    const slug = await getBlockSlugByUuid(localDb, blockUuid)
    
    expect(slug).toBeDefined()
    expect(slug?.slug).toBe('my-test-document')
    expect(slug?.title).toBe('My Test Document')
  })

  test('should handle blocks without titles', async () => {
    // Insert a block without a title using the block functions
    const block = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: 'This is a document without a title.',
      inserter: 'test-user'
    })
    
    const blockUuid = block.block_uuid
    const versionUuid = block.version_uuid
    
    // Run indexing
    const result: IndexSlugsResult = await indexSlugs(localDb)
    
    expect(result.indexedCount).toBe(0) // No slug to index
    expect(result.hasMore).toBe(false)
    
    // Check that the block was still marked as indexed by checking authoritative version
    const authoritativeVersion = await getAuthoritativeVersionByBlockUuid(localDb, blockUuid)
    
    expect(authoritativeVersion).toBeDefined()
    expect(authoritativeVersion?.version_uuid).toBe(versionUuid)
    
    // Check that no slug was created
    const slug = await getBlockSlugByUuid(localDb, blockUuid)
    
    expect(slug).toBeNull()
  })

  test('should update slug when block version changes', async () => {
    // Insert first version with one title using the block functions
    const blockV1 = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Original Title\n\nThis is the first version.',
      inserter: 'test-user'
    })
    
    const blockUuid = blockV1.block_uuid
    const version1Uuid = blockV1.version_uuid
    
    // Run indexing on first version
    await indexSlugs(localDb)
    
    // Check initial slug
    const initialSlug = await getBlockSlugByUuid(localDb, blockUuid)
    
    expect(initialSlug).toBeDefined()
    expect(initialSlug?.slug).toBe('original-title')
    expect(initialSlug?.title).toBe('Original Title')
    
    // Insert second version with updated title using the block functions
    const blockV2 = await createBlockVersion(syncedDb, blockUuid, {
      block_type: 'scribe/markdown',
      body: '# Updated Title\n\nThis is the updated version.',
      inserter: 'test-user'
    })
    
    const version2Uuid = blockV2.version_uuid
    
    // Run indexing again
    const result: IndexSlugsResult = await indexSlugs(localDb)
    
    expect(result.indexedCount).toBe(1)
    expect(result.hasMore).toBe(false)
    
    // Check updated slug
    const updatedSlug = await getBlockSlugByUuid(localDb, blockUuid)
    
    expect(updatedSlug).toBeDefined()
    expect(updatedSlug?.slug).toBe('updated-title')
    expect(updatedSlug?.title).toBe('Updated Title')
    
    // Check that the authoritative version was updated
    const authoritativeVersion = await getAuthoritativeVersionByBlockUuid(localDb, blockUuid)
    
    expect(authoritativeVersion?.version_uuid).toBe(version2Uuid)
  })

  test('should respect indexing limit', async () => {
    // Insert multiple blocks using the block functions
    const blocks = []
    for (let i = 0; i < 5; i++) {
      const block = await createBlock(syncedDb, {
        block_type: 'scribe/markdown',
        body: `# Document ${i}\n\nThis is document number ${i}.`,
        inserter: 'test-user'
      })
      blocks.push(block)
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

  test('should generate unique slugs with UUID prefixes for duplicate titles', async () => {
    // Insert two blocks with the same title using the block functions
    const block1 = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Same Title\n\nThis is the first document with this title.',
      inserter: 'test-user'
    })
    
    const block1Uuid = block1.block_uuid
    const version1Uuid = block1.version_uuid
    
    const block2 = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Same Title\n\nThis is the second document with this title.',
      inserter: 'test-user'
    })
    
    const block2Uuid = block2.block_uuid
    const version2Uuid = block2.version_uuid
    
    // Run indexing
    await indexSlugs(localDb)
    
    // Get both slugs
    const slug1 = await getBlockSlugByUuid(localDb, block1Uuid)
    const slug2 = await getBlockSlugByUuid(localDb, block2Uuid)
    
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

  test('should index tags for new blocks', async () => {
    // Insert a block with tags using the block functions
    const block = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# My Document with Tags\n\nThis document has [#important](#important) and [#work](#work) tags.',
      inserter: 'test-user'
    })
    
    const blockUuid = block.block_uuid
    const versionUuid = block.version_uuid
    
    // Run indexing
    await indexSlugs(localDb)
    
    // Check that tags were indexed
    const tags = await getTagsForBlock(localDb, blockUuid)
    
    expect(tags).toHaveLength(2)
    expect(tags).toContain('important')
    expect(tags).toContain('work')
  })

  test('should add tags to an authoritative version of a block', async () => {
    // Insert first version without tags using the block functions
    const blockV1 = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document has no tags initially.',
      inserter: 'test-user'
    })
    
    const blockUuid = blockV1.block_uuid
    const version1Uuid = blockV1.version_uuid
    
    // Run indexing on first version
    await indexSlugs(localDb)
    
    // Check that no tags exist
    let tags = await getTagsForBlock(localDb, blockUuid)
    
    expect(tags).toHaveLength(0)
    
    // Insert second version with tags using the block functions
    const blockV2 = await createBlockVersion(syncedDb, blockUuid, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document now has [#newtag](#newtag) and [#anothertag](#anothertag) tags.',
      inserter: 'test-user'
    })
    
    const version2Uuid = blockV2.version_uuid
    
    // Run indexing again
    await indexSlugs(localDb)
    
    // Check that tags were added
    tags = await getTagsForBlock(localDb, blockUuid)
    
    expect(tags).toHaveLength(2)
    expect(tags).toContain('newtag')
    expect(tags).toContain('anothertag')
  })

  test('should remove tags from an authoritative version of a block', async () => {
    // Insert first version with tags using the block functions
    const blockV1 = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document has [#tag1](#tag1) and [#tag2](#tag2) tags.',
      inserter: 'test-user'
    })
    
    const blockUuid = blockV1.block_uuid
    const version1Uuid = blockV1.version_uuid
    
    // Run indexing on first version
    await indexSlugs(localDb)
    
    // Check that tags exist
    let tags = await getTagsForBlock(localDb, blockUuid)
    
    expect(tags).toHaveLength(2)
    expect(tags).toContain('tag1')
    expect(tags).toContain('tag2')
    
    // Insert second version with fewer tags using the block functions
    const blockV2 = await createBlockVersion(syncedDb, blockUuid, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document now only has [#tag1](#tag1) tag.',
      inserter: 'test-user'
    })
    
    const version2Uuid = blockV2.version_uuid
    
    // Run indexing again
    await indexSlugs(localDb)
    
    // Check that only remaining tag exists
    tags = await getTagsForBlock(localDb, blockUuid)
    
    expect(tags).toHaveLength(1)
    expect(tags).toContain('tag1')
  })

  test('should change tags in an authoritative version of a block', async () => {
    // Insert first version with some tags using the block functions
    const blockV1 = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document has [#oldtag](#oldtag) tag.',
      inserter: 'test-user'
    })
    
    const blockUuid = blockV1.block_uuid
    const version1Uuid = blockV1.version_uuid
    
    // Run indexing on first version
    await indexSlugs(localDb)
    
    // Check that old tag exists
    let tags = await getTagsForBlock(localDb, blockUuid)
    
    expect(tags).toHaveLength(1)
    expect(tags).toContain('oldtag')
    
    // Insert second version with different tags using the block functions
    const blockV2 = await createBlockVersion(syncedDb, blockUuid, {
      block_type: 'scribe/markdown',
      body: '# Document Title\n\nThis document now has [#newtag](#newtag) and [#different](#different) tags.',
      inserter: 'test-user'
    })
    
    const version2Uuid = blockV2.version_uuid
    
    // Run indexing again
    await indexSlugs(localDb)
    
    // Check that new tags exist and old ones are removed
    tags = await getTagsForBlock(localDb, blockUuid)
    
    expect(tags).toHaveLength(2)
    expect(tags).toContain('newtag')
    expect(tags).toContain('different')
  })

  test('should index both slugs and search vectors with indexAll', async () => {
    // Create test blocks
    const block1 = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# JavaScript Tutorial\n\nLearn JavaScript basics.',
      inserter: 'test-user'
    })
    
    const block2 = await createBlock(syncedDb, {
      block_type: 'scribe/markdown',
      body: '# Python Guide\n\nPython programming essentials.',
      inserter: 'test-user'
    })
    
    // Run indexAll
    const result = await indexAll(localDb)
    
    expect(result.indexedCount).toBe(2)
    expect(result.hasMore).toBe(false)
    
    // Verify slugs were created
    const slug1 = await getBlockSlugByUuid(localDb, block1.block_uuid)
    expect(slug1?.slug).toBe('javascript-tutorial')
    
    // Verify search vectors were created
    const searchResults = await searchBlocks(localDb, 'JavaScript')
    expect(searchResults).toHaveLength(1)
    expect(searchResults[0].block_uuid).toBe(block1.block_uuid)
  })
})
