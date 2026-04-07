import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDraftAutoSave } from '../src/hooks/useDraftAutoSave'
import { getDraft } from '../src/drafts/draftStorage'

/**
 * These tests verify that the auto-save hook does not re-create a draft
 * after it has been explicitly cleared (e.g. after a successful server save).
 *
 * The bug: clearDraft() sets lastSavedBodyRef to null, then the auto-save
 * interval fires, sees body !== null, and re-creates the draft — permanently
 * trapping the user on the edit page because SlugViewPage auto-redirects to
 * edit when a draft exists.
 */
describe('useDraftAutoSave', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should not re-create draft via saveNow after clearDraft', () => {
    const getBody = () => '# Test Content'

    const { result } = renderHook(() =>
      useDraftAutoSave({
        prefix: 'test-prefix',
        draftId: 'block-uuid-123',
        blockUuid: 'block-uuid-123',
        collectionId: null,
        getBody,
      })
    )

    // First save creates the draft
    act(() => {
      result.current.saveNow()
    })
    expect(getDraft('test-prefix', 'block-uuid-123')).not.toBeNull()

    // Clear the draft (simulates what happens after successful server save)
    act(() => {
      result.current.clearDraft()
    })
    expect(getDraft('test-prefix', 'block-uuid-123')).toBeNull()

    // saveNow (same function the auto-save interval calls) should NOT
    // re-create the draft after it was explicitly cleared.
    act(() => {
      result.current.saveNow()
    })
    expect(getDraft('test-prefix', 'block-uuid-123')).toBeNull()
  })

  it('should not re-create draft via auto-save interval after clearDraft', () => {
    const getBody = () => '# Test Content'

    const { result } = renderHook(() =>
      useDraftAutoSave({
        prefix: 'test-prefix',
        draftId: 'block-uuid-123',
        blockUuid: 'block-uuid-123',
        collectionId: null,
        getBody,
      })
    )

    // First save creates the draft
    act(() => {
      result.current.saveNow()
    })
    expect(getDraft('test-prefix', 'block-uuid-123')).not.toBeNull()

    // Clear the draft
    act(() => {
      result.current.clearDraft()
    })
    expect(getDraft('test-prefix', 'block-uuid-123')).toBeNull()

    // Advance past the auto-save interval (5 seconds)
    act(() => {
      vi.advanceTimersByTime(6000)
    })

    // Auto-save should NOT have re-created the draft
    expect(getDraft('test-prefix', 'block-uuid-123')).toBeNull()
  })
})
