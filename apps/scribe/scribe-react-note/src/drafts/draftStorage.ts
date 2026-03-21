/**
 * Browser-specific draft storage layer.
 *
 * All core draft logic lives in scribe-data. This module provides:
 * 1. A localStorage-backed DraftStore implementation
 * 2. Convenience re-exports that bind every function to that store so that
 *    callers in scribe-react don't need to pass the store around.
 */
import {
  saveDraft as _saveDraft,
  getDraft as _getDraft,
  deleteDraft as _deleteDraft,
  getDraftForNote as _getDraftForNote,
  getDraftsForPrefix as _getDraftsForPrefix,
  getDraftSummariesForCollection as _getDraftSummariesForCollection,
  getBlockUuidsWithDrafts as _getBlockUuidsWithDrafts,
  deleteAllDraftsForPrefix as _deleteAllDraftsForPrefix,
  deleteAllDrafts as _deleteAllDrafts,
  type DraftStore,
  type Draft,
  type DraftSummary,
} from 'scribe-data'

// Re-export types so existing imports keep working.
export type { Draft, DraftSummary, DraftStore }

// ---------------------------------------------------------------------------
// localStorage adapter
// ---------------------------------------------------------------------------

class LocalStorageDraftStore implements DraftStore {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // localStorage may be full or unavailable
    }
  }

  removeItem(key: string): void {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }

  keys(): string[] {
    try {
      const result: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key) result.push(key)
      }
      return result
    } catch {
      return []
    }
  }
}

/** Singleton localStorage-backed store. */
const store = new LocalStorageDraftStore()

// ---------------------------------------------------------------------------
// Bound convenience functions (same signatures as the old module)
// ---------------------------------------------------------------------------

export function saveDraft(draft: Draft): void {
  _saveDraft(store, draft)
}

export function getDraft(prefix: string, draftId: string): Draft | null {
  return _getDraft(store, prefix, draftId)
}

export function deleteDraft(prefix: string, draftId: string): void {
  _deleteDraft(store, prefix, draftId)
}

export function getDraftForNote(prefix: string, blockUuid: string): Draft | null {
  return _getDraftForNote(store, prefix, blockUuid)
}

export function getDraftsForPrefix(prefix: string): Draft[] {
  return _getDraftsForPrefix(store, prefix)
}

export function getDraftSummariesForCollection(
  prefix: string,
  collectionId: string | null
): DraftSummary[] {
  return _getDraftSummariesForCollection(store, prefix, collectionId)
}

export function getBlockUuidsWithDrafts(prefix: string): Set<string> {
  return _getBlockUuidsWithDrafts(store, prefix)
}

export function deleteAllDraftsForPrefix(prefix: string): void {
  _deleteAllDraftsForPrefix(store, prefix)
}

export function deleteAllDrafts(): void {
  _deleteAllDrafts(store)
}
