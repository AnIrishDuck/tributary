import { extractTitleFromMarkdown, titleToSlug } from 'scribe-data'

/**
 * A locally-stored draft of a note being edited.
 *
 * Each draft is stored as a separate localStorage key so that corruption
 * from a hard shutdown is isolated to a single draft rather than wiping
 * all drafts at once.
 */
export interface Draft {
  /** For new notes this is a generated id; for existing notes it equals blockUuid. */
  draftId: string
  /** null when the draft is for a brand-new note. */
  blockUuid: string | null
  /** The collection this draft belongs to (null = library root). */
  collectionId: string | null
  /** The library prefix this draft belongs to. */
  prefix: string
  /** The markdown body of the draft. */
  body: string
  /** ISO-8601 timestamp of the last auto-save. */
  updatedAt: string
}

/**
 * Summary of a draft for display in note lists, without the full body.
 */
export interface DraftSummary {
  draftId: string
  blockUuid: string | null
  collectionId: string | null
  prefix: string
  title: string | null
  slug: string | null
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

const KEY_PREFIX = 'scribe:draft:'

function draftKey(prefix: string, draftId: string): string {
  return `${KEY_PREFIX}${prefix}:${draftId}`
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function saveDraft(draft: Draft): void {
  try {
    const key = draftKey(draft.prefix, draft.draftId)
    localStorage.setItem(key, JSON.stringify(draft))
  } catch {
    // localStorage may be full or unavailable – silently ignore
  }
}

export function getDraft(prefix: string, draftId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(prefix, draftId))
    if (!raw) return null
    return JSON.parse(raw) as Draft
  } catch {
    // Corrupted entry – discard it
    deleteDraft(prefix, draftId)
    return null
  }
}

export function deleteDraft(prefix: string, draftId: string): void {
  try {
    localStorage.removeItem(draftKey(prefix, draftId))
  } catch {
    // nothing we can do
  }
}

/**
 * Get the draft for an existing note (if any).
 * For existing notes the draftId is always the blockUuid.
 */
export function getDraftForNote(prefix: string, blockUuid: string): Draft | null {
  return getDraft(prefix, blockUuid)
}

// ---------------------------------------------------------------------------
// Listing / querying
// ---------------------------------------------------------------------------

/**
 * Return all drafts for a given library prefix.
 */
export function getDraftsForPrefix(prefix: string): Draft[] {
  const keyStart = `${KEY_PREFIX}${prefix}:`
  const drafts: Draft[] = []

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(keyStart)) continue
      try {
        const raw = localStorage.getItem(key)
        if (raw) drafts.push(JSON.parse(raw) as Draft)
      } catch {
        // skip corrupted entry
      }
    }
  } catch {
    // localStorage unavailable
  }

  return drafts
}

/**
 * Return summaries (without body) of drafts in a specific collection.
 * Pass `null` for collectionId to get library-root drafts.
 */
export function getDraftSummariesForCollection(
  prefix: string,
  collectionId: string | null
): DraftSummary[] {
  return getDraftsForPrefix(prefix)
    .filter((d) => d.collectionId === collectionId)
    .map(draftToSummary)
}

/**
 * Return a set of blockUuids that have local drafts for the given prefix.
 */
export function getBlockUuidsWithDrafts(prefix: string): Set<string> {
  const uuids = new Set<string>()
  for (const d of getDraftsForPrefix(prefix)) {
    if (d.blockUuid) uuids.add(d.blockUuid)
  }
  return uuids
}

/**
 * Delete all drafts for a library (e.g. on logout).
 */
export function deleteAllDraftsForPrefix(prefix: string): void {
  const keyStart = `${KEY_PREFIX}${prefix}:`
  const keysToDelete: string[] = []

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(keyStart)) keysToDelete.push(key)
    }
    for (const key of keysToDelete) {
      localStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function draftToSummary(d: Draft): DraftSummary {
  const title = extractTitleFromMarkdown(d.body)
  return {
    draftId: d.draftId,
    blockUuid: d.blockUuid,
    collectionId: d.collectionId,
    prefix: d.prefix,
    title,
    slug: title ? titleToSlug(title) : null,
    updatedAt: d.updatedAt,
  }
}
