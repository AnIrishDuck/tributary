import { useEffect, useRef, useCallback } from 'react'
import { saveDraft, deleteDraft, getDraft, type Draft } from '../drafts/draftStorage'

const AUTO_SAVE_INTERVAL_MS = 5_000

interface UseDraftAutoSaveOptions {
  /** Library prefix. */
  prefix: string
  /**
   * Stable draft id.
   * For existing notes this equals blockUuid.
   * For new notes pass a generated id that is stable for the editor session.
   */
  draftId: string
  /** null for new notes. */
  blockUuid: string | null
  /** Collection the note belongs to (null = library root). */
  collectionId: string | null
  /** A function that returns the current editor body. */
  getBody: () => string
  /** A function that returns the version UUID the editor was loaded with (existing notes only). */
  getBaseVersionUuid?: () => string | null
}

/**
 * Periodically auto-saves the current editor content as a local draft.
 *
 * Returns helpers to load an existing draft and to clear it on successful save.
 */
export function useDraftAutoSave({
  prefix,
  draftId,
  blockUuid,
  collectionId,
  getBody,
  getBaseVersionUuid,
}: UseDraftAutoSaveOptions) {
  // Track the "last persisted body" so we only write when content changes.
  const lastSavedBodyRef = useRef<string | null>(null)
  // Once the draft has been explicitly cleared (e.g. after a successful save),
  // prevent the auto-save interval from re-creating it.
  const clearedRef = useRef(false)

  const save = useCallback(() => {
    if (clearedRef.current) return // draft was cleared, don't re-save
    const body = getBody()
    if (body === lastSavedBodyRef.current) return // nothing changed
    lastSavedBodyRef.current = body
    saveDraft({
      draftId,
      blockUuid,
      collectionId: collectionId ?? null,
      prefix,
      body,
      baseVersionUuid: getBaseVersionUuid?.() ?? null,
      updatedAt: new Date().toISOString(),
    })
  }, [prefix, draftId, blockUuid, collectionId, getBody, getBaseVersionUuid])

  // Set up the auto-save interval.
  useEffect(() => {
    const id = setInterval(save, AUTO_SAVE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [save])

  // Also save when the tab is being hidden / closed.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        save()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [save])

  /** Load an existing draft (if any). Returns body and baseVersionUuid. */
  const loadDraft = useCallback((): { body: string; baseVersionUuid?: string | null } | null => {
    const d = getDraft(prefix, draftId)
    if (d) {
      lastSavedBodyRef.current = d.body
      return { body: d.body, baseVersionUuid: d.baseVersionUuid }
    }
    return null
  }, [prefix, draftId])

  /** Clear the draft (call after a successful save to server or on cancel). */
  const clearDraft = useCallback(() => {
    clearedRef.current = true
    deleteDraft(prefix, draftId)
    lastSavedBodyRef.current = null
  }, [prefix, draftId])

  return { loadDraft, clearDraft, saveNow: save }
}
