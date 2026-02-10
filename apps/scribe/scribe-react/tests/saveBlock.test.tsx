import { describe, it, expect, beforeEach } from 'vitest'
import { createTestClientWithStream } from './test-utils'
import { saveBlock } from '../src/actions/saveBlock'
import { getBlockCount, getBlockVersionCount } from 'scribe-data/src/block'

describe('saveBlock function', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('should create a new block when no blockUuid is provided', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Check initial state
    const initialBlockCount = await getBlockCount(stream)
    expect(initialBlockCount).toBe(0)
    
    // Save a new block
    const { block, blockSlug } = await saveBlock(stream, '# New Document\n\nContent here')
    
    // Verify the block was created
    const finalBlockCount = await getBlockCount(stream)
    expect(finalBlockCount).toBe(1)
    expect(blockSlug).toBeDefined()
    expect(block.block_uuid).toBeDefined()
  })

  it('should create a new version when blockUuid is provided', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // First, create an initial block
    const { block } = await saveBlock(stream, '# Original Document\n\nOriginal content')
    const initialBlockUuid = block.block_uuid
    
    // Check initial version count
    const initialVersionCount = await getBlockVersionCount(stream, initialBlockUuid)
    expect(initialVersionCount).toBe(1)
    
    // Now update the block by providing blockUuid
    const { block: updatedBlock } = await saveBlock(stream, '# Updated Document\n\nUpdated content', 'web-ui', initialBlockUuid)
    
    // Verify the version count increased to 2
    const finalVersionCount = await getBlockVersionCount(stream, initialBlockUuid)
    expect(finalVersionCount).toBe(2)
    
    // Verify the block UUID stayed the same (new version of same block)
    expect(updatedBlock.block_uuid).toBe(initialBlockUuid)
  })

  it('should preserve block UUID when creating new block (no blockUuid)', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Save a new block (no blockUuid)
    const { block: block1 } = await saveBlock(stream, '# Document 1')
    
    // Save another new block (no blockUuid)
    const { block: block2 } = await saveBlock(stream, '# Document 2')
    
    // Both blocks should have different UUIDs
    expect(block1.block_uuid).toBeDefined()
    expect(block2.block_uuid).toBeDefined()
    expect(block1.block_uuid).not.toBe(block2.block_uuid)
  })
})
