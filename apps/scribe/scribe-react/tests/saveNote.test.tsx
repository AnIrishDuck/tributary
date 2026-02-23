import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestClientWithStream } from './test-utils'
import { saveNote } from '../src/actions/saveNote'
import { getNoteCount, getNoteVersionCount } from 'scribe-data/src/note'
import { searchNotes } from 'scribe-data'

describe('saveNote function', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('should create a new note when no blockUuid is provided', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Check initial state
    const initialNoteCount = await getNoteCount(stream)
    expect(initialNoteCount).toBe(0)
    
    // Save a new note
    const { block, blockSlug } = await saveNote(stream, '# New Document\n\nContent here')
    
    // Verify the note was created
    const finalNoteCount = await getNoteCount(stream)
    expect(finalNoteCount).toBe(1)
    expect(blockSlug).toBeDefined()
    expect(block.block_uuid).toBeDefined()
  })

  it('should create a new version when blockUuid is provided', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // First, create an initial note
    const { block } = await saveNote(stream, '# Original Document\n\nOriginal content')
    const initialBlockUuid = block.block_uuid
    
    // Check initial version count
    const initialVersionCount = await getNoteVersionCount(stream, initialBlockUuid)
    expect(initialVersionCount).toBe(1)
    
    // Now update the note by providing blockUuid
    const { block: updatedBlock } = await saveNote(stream, '# Updated Document\n\nUpdated content', 'web-ui', initialBlockUuid)
    
    // Verify the version count increased to 2
    const finalVersionCount = await getNoteVersionCount(stream, initialBlockUuid)
    expect(finalVersionCount).toBe(2)
    
    // Verify the block UUID stayed the same (new version of same note)
    expect(updatedBlock.block_uuid).toBe(initialBlockUuid)
  })

  it('should index the saved note for full-text search', async () => {
    const { stream } = await createTestClientWithStream()

    // Save a note with distinctive content
    await saveNote(stream, '# Photosynthesis\n\nPlants convert sunlight into energy through chlorophyll.')

    // Without calling indexAll again, search should find the note
    // because saveNote itself should run full indexing (not just slug indexing)
    const localDb = stream.local()
    const results = await searchNotes(localDb, 'photosynthesis')

    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('Photosynthesis')
  })

  it('should preserve block UUID when creating new note (no blockUuid)', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Save a new note (no blockUuid)
    const { block: block1 } = await saveNote(stream, '# Document 1')
    
    // Save another new note (no blockUuid)
    const { block: block2 } = await saveNote(stream, '# Document 2')
    
    // Both notes should have different UUIDs
    expect(block1.block_uuid).toBeDefined()
    expect(block2.block_uuid).toBeDefined()
    expect(block1.block_uuid).not.toBe(block2.block_uuid)
  })
})
