import { extractTitleFromMarkdown, titleToSlug } from './indexing.js'

/**
 * A locally-stored draft of a note being edited.
 *
 * Each draft is stored as a separate key so that corruption from a hard
 * shutdown is isolated to a single draft rather than wiping all drafts at once.
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
  /** The authoritative version UUID the draft was based on (existing notes only). */
  baseVersionUuid?: string | null
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

/**
 * Minimal key-value store interface that draft storage requires.
 *
 * In the browser this is backed by `localStorage`; in tests a simple
 * in-memory Map works.
 */
export interface DraftStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  /** Return all keys currently in the store. */
  keys(): string[]
}

// ---------------------------------------------------------------------------
// Key helpers
// ---------------------------------------------------------------------------

const KEY_PREFIX = 'scribe:draft:'

export function draftKey(prefix: string, draftId: string): string {
  return `${KEY_PREFIX}${prefix}:${draftId}`
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function saveDraft(store: DraftStore, draft: Draft): void {
  try {
    const key = draftKey(draft.prefix, draft.draftId)
    store.setItem(key, JSON.stringify(draft))
  } catch {
    // Store may be full or unavailable – silently ignore
  }
}

export function getDraft(store: DraftStore, prefix: string, draftId: string): Draft | null {
  try {
    const raw = store.getItem(draftKey(prefix, draftId))
    if (!raw) return null
    return JSON.parse(raw) as Draft
  } catch {
    // Corrupted entry – discard it
    deleteDraft(store, prefix, draftId)
    return null
  }
}

export function deleteDraft(store: DraftStore, prefix: string, draftId: string): void {
  try {
    store.removeItem(draftKey(prefix, draftId))
  } catch {
    // nothing we can do
  }
}

/**
 * Get the draft for an existing note (if any).
 * For existing notes the draftId is always the blockUuid.
 */
export function getDraftForNote(store: DraftStore, prefix: string, blockUuid: string): Draft | null {
  return getDraft(store, prefix, blockUuid)
}

// ---------------------------------------------------------------------------
// Listing / querying
// ---------------------------------------------------------------------------

/**
 * Return all drafts for a given library prefix.
 */
export function getDraftsForPrefix(store: DraftStore, prefix: string): Draft[] {
  const keyStart = `${KEY_PREFIX}${prefix}:`
  const drafts: Draft[] = []

  try {
    for (const key of store.keys()) {
      if (!key.startsWith(keyStart)) continue
      try {
        const raw = store.getItem(key)
        if (raw) drafts.push(JSON.parse(raw) as Draft)
      } catch {
        // skip corrupted entry
      }
    }
  } catch {
    // store unavailable
  }

  return drafts
}

/**
 * Return summaries (without body) of drafts in a specific collection.
 * Pass `null` for collectionId to get library-root drafts.
 */
export function getDraftSummariesForCollection(
  store: DraftStore,
  prefix: string,
  collectionId: string | null
): DraftSummary[] {
  return getDraftsForPrefix(store, prefix)
    .filter((d) => d.collectionId === collectionId)
    .map(draftToSummary)
}

/**
 * Return a set of blockUuids that have local drafts for the given prefix.
 */
export function getBlockUuidsWithDrafts(store: DraftStore, prefix: string): Set<string> {
  const uuids = new Set<string>()
  for (const d of getDraftsForPrefix(store, prefix)) {
    if (d.blockUuid) uuids.add(d.blockUuid)
  }
  return uuids
}

/**
 * Delete all drafts for a library (e.g. on logout).
 */
export function deleteAllDraftsForPrefix(store: DraftStore, prefix: string): void {
  const keyStart = `${KEY_PREFIX}${prefix}:`
  const keysToDelete: string[] = []

  try {
    for (const key of store.keys()) {
      if (key.startsWith(keyStart)) keysToDelete.push(key)
    }
    for (const key of keysToDelete) {
      store.removeItem(key)
    }
  } catch {
    // ignore
  }
}

/**
 * Delete every draft in the store regardless of prefix (e.g. on account clear).
 */
export function deleteAllDrafts(store: DraftStore): void {
  const keysToDelete: string[] = []

  try {
    for (const key of store.keys()) {
      if (key.startsWith(KEY_PREFIX)) keysToDelete.push(key)
    }
    for (const key of keysToDelete) {
      store.removeItem(key)
    }
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function draftToSummary(d: Draft): DraftSummary {
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

// ---------------------------------------------------------------------------
// In-memory store for testing
// ---------------------------------------------------------------------------

/**
 * Simple in-memory implementation of DraftStore for testing.
 */
export class MemoryDraftStore implements DraftStore {
  private data = new Map<string, string>()

  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  keys(): string[] {
    return Array.from(this.data.keys())
  }
}
