import { test, expect, describe, beforeEach, afterEach } from 'vitest'
import { v4 as uuidv4 } from 'uuid'
import { up } from '../src/migrations.js'
import {
  searchNotes,
  indexSearchVectors,
  extractSearchableText,
  extractTitle,
  type SearchResult
} from '../src/search.js'
import { indexSlugs, indexAll } from '../src/indexing.js'
import { createTestDB } from './test-utils.js'
import { TributaryStream, TributaryLocal } from 'tributary-client'
import { createNote, createNoteVersion } from '../src/note.js'
import { createCollection } from '../src/collection.js'

describe('Full-text search', () => {
  let syncedDb: TributaryStream
  let localDb: TributaryLocal
  let cleanup: () => Promise<void>

  beforeEach(async () => {
    const result = await createTestDB()
    syncedDb = result.syncedDb
    localDb = result.localDb
    cleanup = async () => {
      // Cleanup is handled by the test framework
    }
    await up(syncedDb, localDb)
  })

  afterEach(async () => {
    if (cleanup) await cleanup()
  })

  describe('Text extraction', () => {
    test('should extract plain text from simple markdown', () => {
      const markdown = '# Title\n\nThis is **bold** and *italic* text.'
      const text = extractSearchableText(markdown)
      expect(text).toBe('Title This is bold and italic text.')
    })

    test('should remove markdown headers but keep text', () => {
      const markdown = '# Header 1\n## Header 2\n### Header 3\nPlain text'
      const text = extractSearchableText(markdown)
      expect(text).toBe('Header 1 Header 2 Header 3 Plain text')
    })

    test('should remove markdown bold and italic but keep text', () => {
      const markdown = 'This is **bold** and __also bold__ and *italic* and _also italic_ text.'
      const text = extractSearchableText(markdown)
      expect(text).toBe('This is bold and also bold and italic and also italic text.')
    })

    test('should remove markdown links but keep link text', () => {
      const markdown = 'This is a [link](https://example.com) and another [link](url).'
      const text = extractSearchableText(markdown)
      expect(text).toBe('This is a link and another link.')
    })

    test('should remove code blocks and inline code', () => {
      const markdown = 'Text with `inline code` and\n```\ncode block\n```\nmore text.'
      const text = extractSearchableText(markdown)
      expect(text).toBe('Text with and more text.')
    })

    test('should handle empty or whitespace-only content', () => {
      expect(extractSearchableText('')).toBe('')
      expect(extractSearchableText('   \n  \n  ')).toBe('')
      expect(extractSearchableText('```\ncode\n```')).toBe('')
    })

    test('should normalize whitespace', () => {
      const markdown = 'Multiple    spaces\n\n\nand\n\nnewlines'
      const text = extractSearchableText(markdown)
      expect(text).toBe('Multiple spaces and newlines')
    })

    test('should remove images but keep alt text', () => {
      const markdown = 'Text with ![alt text](image.png) image.'
      const text = extractSearchableText(markdown)
      expect(text).toBe('Text with alt text image.')
    })

    test('should remove list markers', () => {
      const markdown = '- Item 1\n- Item 2\n1. Numbered 1\n2. Numbered 2'
      const text = extractSearchableText(markdown)
      expect(text).toBe('Item 1 Item 2 Numbered 1 Numbered 2')
    })

    test('should remove blockquote markers', () => {
      const markdown = '> This is a quote\n> Another line'
      const text = extractSearchableText(markdown)
      expect(text).toBe('This is a quote Another line')
    })

    test('should remove horizontal rules', () => {
      const markdown = 'Text\n---\nMore text\n***\nEven more'
      const text = extractSearchableText(markdown)
      expect(text).toBe('Text More text Even more')
    })
  })

  describe('Title extraction', () => {
    test('should extract title from markdown heading', () => {
      expect(extractTitle('# My Title\n\nBody text.')).toBe('My Title')
    })

    test('should return empty string when no heading exists', () => {
      expect(extractTitle('No heading here.')).toBe('')
    })

    test('should extract only the first h1 heading', () => {
      expect(extractTitle('# First\n## Second\n# Third')).toBe('First')
    })

    test('should strip inline markdown from title', () => {
      expect(extractTitle('# **Bold** Title')).toBe('Bold Title')
    })
  })

  describe('Search vector indexing', () => {
    test('should index search vectors for new notes', async () => {
      // Create test note
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# JavaScript Tutorial\n\nLearn JavaScript basics.',
        inserter: 'test-user'
      })

      // Index authoritative versions first (required for search indexing)
      await indexSlugs(localDb)
      
      // Index search vectors
      const result = await indexSearchVectors(localDb)
      
      expect(result.indexedCount).toBe(1)
      expect(result.hasMore).toBe(false)

      // Verify search vector was created
      const searchResult = await localDb.query(
        'SELECT * FROM block_search_index WHERE block_uuid = $1',
        [note.block_uuid]
      )
      
      expect(searchResult.rows).toHaveLength(1)
      expect(searchResult.rows![0].version_uuid).toBe(note.version_uuid)
    })

    test('should update search vector when note version changes', async () => {
      // Create initial note
      const noteV1 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Original Content\n\nThis is the first version.',
        inserter: 'test-user'
      })

      // Index first version
      await indexSlugs(localDb)
      await indexSearchVectors(localDb)

      // Create new version
      const noteV2 = await createNoteVersion(syncedDb, noteV1.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Updated Content\n\nThis is the updated version.',
        inserter: 'test-user'
      })

      // Index should be updated
      await indexSlugs(localDb)
      const result = await indexSearchVectors(localDb)
      
      expect(result.indexedCount).toBe(1)

      // Verify search vector was updated
      const searchResult = await localDb.query(
        'SELECT * FROM block_search_index WHERE block_uuid = $1',
        [noteV1.block_uuid]
      )
      
      expect(searchResult.rows).toHaveLength(1)
      expect(searchResult.rows![0].version_uuid).toBe(noteV2.version_uuid)
    })

    test('should handle notes without content', async () => {
      // Create note with only markdown syntax (no actual text)
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '```\ncode\n```',
        inserter: 'test-user'
      })

      await indexSlugs(localDb)
      const result = await indexSearchVectors(localDb)
      
      // Should process but not create search vector for empty content
      expect(result.indexedCount).toBe(0)

      // Verify no search vector was created
      const searchResult = await localDb.query(
        'SELECT * FROM block_search_index WHERE block_uuid = $1',
        [note.block_uuid]
      )
      
      expect(searchResult.rows).toHaveLength(0)
    })

    test('should respect indexing limit', async () => {
      // Create multiple notes
      for (let i = 0; i < 5; i++) {
        await createNote(syncedDb, {
          block_type: 'scribe/markdown',
          body: `# Document ${i}\n\nContent for document ${i}.`,
          inserter: 'test-user'
        })
      }

      await indexSlugs(localDb)
      
      // Index with limit
      const result1 = await indexSearchVectors(localDb, { limit: 3 })
      expect(result1.indexedCount).toBe(3)
      expect(result1.hasMore).toBe(true)

      // Index remaining
      const result2 = await indexSearchVectors(localDb, { limit: 3 })
      expect(result2.indexedCount).toBe(2)
      expect(result2.hasMore).toBe(false)
    })

    test('should delete search vector for notes with no searchable text', async () => {
      // Create note with text
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Title\n\nSome content.',
        inserter: 'test-user'
      })

      await indexSlugs(localDb)
      await indexSearchVectors(localDb)

      // Verify search vector exists
      let searchResult = await localDb.query(
        'SELECT * FROM block_search_index WHERE block_uuid = $1',
        [note.block_uuid]
      )
      expect(searchResult.rows).toHaveLength(1)

      // Update to version with no searchable text
      await createNoteVersion(syncedDb, note.block_uuid, {
        block_type: 'scribe/markdown',
        body: '```\nonly code\n```',
        inserter: 'test-user'
      })

      await indexSlugs(localDb)
      await indexSearchVectors(localDb)

      // Verify search vector was deleted
      searchResult = await localDb.query(
        'SELECT * FROM block_search_index WHERE block_uuid = $1',
        [note.block_uuid]
      )
      expect(searchResult.rows).toHaveLength(0)
    })
  })

  describe('Search queries', () => {
    test('should find notes matching single word query', async () => {
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
      
      await indexAll(localDb)
      
      // Search for "JavaScript"
      const results = await searchNotes(localDb, 'JavaScript')
      
      expect(results).toHaveLength(1)
      expect(results[0].block_uuid).toBe(note1.block_uuid)
      expect(results[0].title).toBe('javascript-tutorial')
    })

    test('should find notes matching multi-word query', async () => {
      // Create test notes
      const note1 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# JavaScript Tutorial\n\nLearn JavaScript basics and advanced concepts.',
        inserter: 'test-user'
      })
      
      const note2 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Python Guide\n\nPython programming essentials.',
        inserter: 'test-user'
      })
      
      await indexAll(localDb)
      
      // Search for "JavaScript advanced" (both words must match)
      const results = await searchNotes(localDb, 'JavaScript advanced')
      
      expect(results).toHaveLength(1)
      expect(results[0].block_uuid).toBe(note1.block_uuid)
    })

    test('should rank results by relevance', async () => {
      // Create notes with different relevance
      const note1 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# JavaScript\n\nJavaScript JavaScript JavaScript',
        inserter: 'test-user'
      })

      const note2 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Web Dev\n\nSome JavaScript here.',
        inserter: 'test-user'
      })

      await indexAll(localDb)

      const results = await searchNotes(localDb, 'JavaScript')

      expect(results).toHaveLength(2)
      // note1 should rank higher (more occurrences)
      expect(results[0].block_uuid).toBe(note1.block_uuid)
      expect(results[0].rank).toBeGreaterThan(results[1].rank)
    })

    test('should rank title matches above body-only matches', async () => {
      // note with "kubernetes" only in body
      const bodyNote = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Infrastructure Guide\n\nDeploy services to kubernetes clusters efficiently.',
        inserter: 'test-user'
      })

      // note with "kubernetes" in title
      const titleNote = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Kubernetes\n\nContainer orchestration platform overview.',
        inserter: 'test-user'
      })

      await indexAll(localDb)

      const results = await searchNotes(localDb, 'kubernetes')

      expect(results).toHaveLength(2)
      // Title match should come first
      expect(results[0].block_uuid).toBe(titleNote.block_uuid)
      expect(results[0].rank).toBeGreaterThan(results[1].rank)
    })

    test('should return empty results for non-matching query', async () => {
      // Create test note
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# JavaScript Tutorial\n\nLearn JavaScript basics.',
        inserter: 'test-user'
      })
      
      await indexAll(localDb)
      
      // Search for something that doesn't exist
      const results = await searchNotes(localDb, 'Nonexistent')
      
      expect(results).toHaveLength(0)
    })

    test('should find notes matching partial word prefix', async () => {
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

      await indexAll(localDb)

      // Partial prefix "Java" should match "JavaScript"
      const results = await searchNotes(localDb, 'Java')
      expect(results).toHaveLength(1)
      expect(results[0].block_uuid).toBe(note1.block_uuid)
    })

    test('should find notes matching partial multi-word prefix query', async () => {
      const note1 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# JavaScript Tutorial\n\nLearn JavaScript basics and advanced concepts.',
        inserter: 'test-user'
      })

      const note2 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# JavaScript Guide\n\nQuick reference for JavaScript.',
        inserter: 'test-user'
      })

      await indexAll(localDb)

      // "Jav adv" should match note1 (JavaScript + advanced) but not note2
      const results = await searchNotes(localDb, 'Jav adv')
      expect(results).toHaveLength(1)
      expect(results[0].block_uuid).toBe(note1.block_uuid)
    })

    test('should handle empty query gracefully', async () => {
      // Create test note
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# JavaScript Tutorial\n\nLearn JavaScript basics.',
        inserter: 'test-user'
      })
      
      await indexAll(localDb)
      
      // Search with empty query
      const results1 = await searchNotes(localDb, '')
      expect(results1).toHaveLength(0)
      
      const results2 = await searchNotes(localDb, '   ')
      expect(results2).toHaveLength(0)
    })

    test('should support pagination with limit and offset', async () => {
      // Create multiple notes
      for (let i = 0; i < 5; i++) {
        await createNote(syncedDb, {
          block_type: 'scribe/markdown',
          body: `# Document ${i}\n\nThis document contains the word tutorial.`,
          inserter: 'test-user'
        })
      }
      
      await indexAll(localDb)
      
      // Get first page
      const page1 = await searchNotes(localDb, 'tutorial', { limit: 2, offset: 0 })
      expect(page1).toHaveLength(2)
      
      // Get second page
      const page2 = await searchNotes(localDb, 'tutorial', { limit: 2, offset: 2 })
      expect(page2).toHaveLength(2)
      
      // Should be different results
      expect(page1[0].block_uuid).not.toBe(page2[0].block_uuid)
      
      // Get third page
      const page3 = await searchNotes(localDb, 'tutorial', { limit: 2, offset: 4 })
      expect(page3).toHaveLength(1)
    })

    test('should include title and slug in results', async () => {
      // Create test note with title
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# My Tutorial\n\nLearn about tutorials.',
        inserter: 'test-user'
      })
      
      await indexAll(localDb)
      
      const results = await searchNotes(localDb, 'tutorial')
      
      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('my-tutorial')
      expect(results[0].slug).toBe('my-tutorial')
    })

    test('should generate snippet in results', async () => {
      // Create test note
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Tutorial\n\nThis is a comprehensive tutorial about JavaScript programming.',
        inserter: 'test-user'
      })
      
      await indexAll(localDb)
      
      const results = await searchNotes(localDb, 'JavaScript')
      
      expect(results).toHaveLength(1)
      expect(results[0].snippet).toBeTruthy()
      expect(results[0].snippet.toLowerCase()).toContain('javascript')
    })

    test('should handle notes without titles', async () => {
      // Create test note without title
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: 'This document has no title but contains searchable content.',
        inserter: 'test-user'
      })
      
      await indexAll(localDb)
      
      const results = await searchNotes(localDb, 'searchable')
      
      expect(results).toHaveLength(1)
      expect(results[0].block_uuid).toBe(note.block_uuid)
      // Notes without titles still have a slug (falls back to block_uuid)
      expect(results[0].slug).toBe(note.block_uuid)
    })
  })

  describe('Integration tests', () => {
    test('should search notes after full indexing', async () => {
      // Create multiple notes
      const note1 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# JavaScript Basics\n\nIntroduction to JavaScript programming.',
        inserter: 'test-user'
      })
      
      const note2 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Advanced JavaScript\n\nDeep dive into JavaScript concepts.',
        inserter: 'test-user'
      })
      
      const note3 = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Python Basics\n\nIntroduction to Python programming.',
        inserter: 'test-user'
      })
      
      // Use indexAll for complete indexing
      const result = await indexAll(localDb)
      expect(result.indexedCount).toBe(3)
      
      // Search should work
      const jsResults = await searchNotes(localDb, 'JavaScript')
      expect(jsResults).toHaveLength(2)
      
      const pythonResults = await searchNotes(localDb, 'Python')
      expect(pythonResults).toHaveLength(1)
      
      const basicsResults = await searchNotes(localDb, 'Basics')
      expect(basicsResults).toHaveLength(2)
    })

    test('should find updated content after note version change', async () => {
      // Create initial note
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Original\n\nThis is about Python.',
        inserter: 'test-user'
      })
      
      await indexAll(localDb)
      
      // Should find Python
      let results = await searchNotes(localDb, 'Python')
      expect(results).toHaveLength(1)
      
      // Should not find JavaScript
      results = await searchNotes(localDb, 'JavaScript')
      expect(results).toHaveLength(0)
      
      // Update note
      await createNoteVersion(syncedDb, note.block_uuid, {
        block_type: 'scribe/markdown',
        body: '# Updated\n\nThis is now about JavaScript.',
        inserter: 'test-user'
      })
      
      await indexAll(localDb)
      
      // Should now find JavaScript
      results = await searchNotes(localDb, 'JavaScript')
      expect(results).toHaveLength(1)
      
      // Should not find Python anymore
      results = await searchNotes(localDb, 'Python')
      expect(results).toHaveLength(0)
    })

    test('should search across multiple documents', async () => {
      // Create documents on various topics
      const topics = [
        { title: 'Web Development', content: 'HTML, CSS, and JavaScript fundamentals.' },
        { title: 'Backend Systems', content: 'Node.js and Express framework.' },
        { title: 'Database Design', content: 'PostgreSQL and SQL queries.' },
        { title: 'DevOps', content: 'Docker, Kubernetes, and CI/CD pipelines.' },
        { title: 'Frontend Frameworks', content: 'React, Vue, and Angular comparison.' }
      ]
      
      for (const topic of topics) {
        await createNote(syncedDb, {
          block_type: 'scribe/markdown',
          body: `# ${topic.title}\n\n${topic.content}`,
          inserter: 'test-user'
        })
      }
      
      await indexAll(localDb)
      
      // Search for different terms
      const webResults = await searchNotes(localDb, 'JavaScript')
      expect(webResults.length).toBeGreaterThan(0)
      
      const dbResults = await searchNotes(localDb, 'PostgreSQL')
      expect(dbResults.length).toBeGreaterThan(0)
      
      const devopsResults = await searchNotes(localDb, 'Docker')
      expect(devopsResults.length).toBeGreaterThan(0)
    })

    test('should work with indexAll function', async () => {
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
      
      // Verify authoritative versions were created
      const avResult = await localDb.query(
        'SELECT * FROM authoritative_version WHERE block_uuid = $1',
        [note1.block_uuid]
      )
      expect(avResult.rows).toHaveLength(1)

      // Verify search vectors were created
      const searchResults = await searchNotes(localDb, 'JavaScript')
      expect(searchResults).toHaveLength(1)
      expect(searchResults[0].block_uuid).toBe(note1.block_uuid)
    })

    test('should handle case-insensitive search', async () => {
      // Create test note
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# JavaScript Tutorial\n\nLearn JavaScript basics.',
        inserter: 'test-user'
      })

      await indexAll(localDb)

      // Search with different cases
      const results1 = await searchNotes(localDb, 'javascript')
      expect(results1).toHaveLength(1)

      const results2 = await searchNotes(localDb, 'JAVASCRIPT')
      expect(results2).toHaveLength(1)

      const results3 = await searchNotes(localDb, 'JavaScript')
      expect(results3).toHaveLength(1)
    })
  })

  describe('Collection-aware search slugs', () => {
    test('should include collection path in slug for notes inside a collection', async () => {
      // Create library (root collection)
      const library = await createCollection(syncedDb, {
        title: 'Notes',
        inserter: 'test-user'
      })

      // Create a child collection
      const collection = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      // Create a note inside the collection
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Pasta Recipe\n\nBoil water and add spaghetti.',
        inserter: 'test-user',
        collection_id: collection.collection_uuid
      })

      await indexAll(localDb)

      const results = await searchNotes(localDb, 'spaghetti')
      expect(results).toHaveLength(1)
      // The slug should include the collection path prefix
      expect(results[0].slug).toBe('cooking/pasta-recipe')
    })

    test('should not add collection prefix for root-level notes', async () => {
      // Create library (root collection)
      await createCollection(syncedDb, {
        title: 'Notes',
        inserter: 'test-user'
      })

      // Create a note at the root (no collection)
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Root Note\n\nThis note is at the root level.',
        inserter: 'test-user'
      })

      await indexAll(localDb)

      const results = await searchNotes(localDb, 'root')
      expect(results).toHaveLength(1)
      // Root-level notes should have a plain slug with no path prefix
      expect(results[0].slug).toBe('root-note')
    })

    test('should handle nested collections in slug path', async () => {
      // Create library (root collection)
      const library = await createCollection(syncedDb, {
        title: 'Notes',
        inserter: 'test-user'
      })

      // Create parent collection
      const parentCollection = await createCollection(syncedDb, {
        title: 'Cooking',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      // Create child collection
      const childCollection = await createCollection(syncedDb, {
        title: 'Italian',
        parent_collection_uuid: parentCollection.collection_uuid,
        inserter: 'test-user'
      })

      // Create a note inside the nested collection
      const note = await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Tiramisu\n\nA classic Italian dessert recipe.',
        inserter: 'test-user',
        collection_id: childCollection.collection_uuid
      })

      await indexAll(localDb)

      const results = await searchNotes(localDb, 'tiramisu')
      expect(results).toHaveLength(1)
      // Should include the full nested collection path
      expect(results[0].slug).toBe('cooking/italian/tiramisu')
    })

    test('should differentiate same-slug notes in different collections', async () => {
      // Create library
      const library = await createCollection(syncedDb, {
        title: 'Notes',
        inserter: 'test-user'
      })

      // Create two collections
      const collection1 = await createCollection(syncedDb, {
        title: 'Work',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      const collection2 = await createCollection(syncedDb, {
        title: 'Personal',
        parent_collection_uuid: library.collection_uuid,
        inserter: 'test-user'
      })

      // Create notes with the same title in different collections
      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Meeting Notes\n\nDiscussed quarterly targets and revenue projections.',
        inserter: 'test-user',
        collection_id: collection1.collection_uuid
      })

      await createNote(syncedDb, {
        block_type: 'scribe/markdown',
        body: '# Meeting Notes\n\nPlanned family reunion and vacation logistics.',
        inserter: 'test-user',
        collection_id: collection2.collection_uuid
      })

      await indexAll(localDb)

      const results = await searchNotes(localDb, 'meeting')
      expect(results).toHaveLength(2)

      const slugs = results.map(r => r.slug).sort()
      expect(slugs).toEqual(['personal/meeting-notes', 'work/meeting-notes'])
    })
  })
})
