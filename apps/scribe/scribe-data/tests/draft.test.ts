import { test, expect, describe, beforeEach } from 'vitest'
import {
  saveDraft,
  getDraft,
  deleteDraft,
  getDraftForNote,
  getDraftsForPrefix,
  getDraftSummariesForCollection,
  getBlockUuidsWithDrafts,
  deleteAllDraftsForPrefix,
  draftToSummary,
  draftKey,
  MemoryDraftStore,
  type Draft,
  type DraftStore,
} from '../src/draft.js'

describe('draft storage', () => {
  let store: MemoryDraftStore

  beforeEach(() => {
    store = new MemoryDraftStore()
  })

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function makeDraft(overrides: Partial<Draft> = {}): Draft {
    return {
      draftId: 'draft-1',
      blockUuid: null,
      collectionId: null,
      prefix: 'lib-abc',
      body: '# New Note\n\nSome content.',
      updatedAt: '2026-01-15T12:00:00.000Z',
      ...overrides,
    }
  }

  // -----------------------------------------------------------------------
  // draftKey
  // -----------------------------------------------------------------------

  describe('draftKey', () => {
    test('generates correct key format', () => {
      expect(draftKey('lib-abc', 'draft-1')).toBe('scribe:draft:lib-abc:draft-1')
    })

    test('handles special characters in prefix', () => {
      expect(draftKey('a+b/c=', 'id-1')).toBe('scribe:draft:a+b/c=:id-1')
    })
  })

  // -----------------------------------------------------------------------
  // saveDraft / getDraft
  // -----------------------------------------------------------------------

  describe('saveDraft and getDraft', () => {
    test('round-trips a draft through the store', () => {
      const draft = makeDraft()
      saveDraft(store, draft)

      const loaded = getDraft(store, 'lib-abc', 'draft-1')
      expect(loaded).toEqual(draft)
    })

    test('returns null for a non-existent draft', () => {
      expect(getDraft(store, 'lib-abc', 'missing')).toBeNull()
    })

    test('overwrites an existing draft with the same id', () => {
      saveDraft(store, makeDraft({ body: 'first version' }))
      saveDraft(store, makeDraft({ body: 'second version' }))

      const loaded = getDraft(store, 'lib-abc', 'draft-1')
      expect(loaded?.body).toBe('second version')
    })

    test('stores drafts for different prefixes independently', () => {
      saveDraft(store, makeDraft({ prefix: 'lib-A', draftId: 'd1', body: 'A body' }))
      saveDraft(store, makeDraft({ prefix: 'lib-B', draftId: 'd1', body: 'B body' }))

      expect(getDraft(store, 'lib-A', 'd1')?.body).toBe('A body')
      expect(getDraft(store, 'lib-B', 'd1')?.body).toBe('B body')
    })

    test('discards corrupted entries and returns null', () => {
      // Write invalid JSON directly into the store
      const key = draftKey('lib-abc', 'corrupt')
      store.setItem(key, '{not valid json')

      const result = getDraft(store, 'lib-abc', 'corrupt')
      expect(result).toBeNull()

      // The corrupted key should have been removed
      expect(store.getItem(key)).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // deleteDraft
  // -----------------------------------------------------------------------

  describe('deleteDraft', () => {
    test('removes an existing draft', () => {
      saveDraft(store, makeDraft())
      deleteDraft(store, 'lib-abc', 'draft-1')
      expect(getDraft(store, 'lib-abc', 'draft-1')).toBeNull()
    })

    test('does not throw when deleting a non-existent draft', () => {
      expect(() => deleteDraft(store, 'lib-abc', 'nope')).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // getDraftForNote
  // -----------------------------------------------------------------------

  describe('getDraftForNote', () => {
    test('returns draft keyed by blockUuid', () => {
      const blockUuid = 'block-uuid-123'
      const draft = makeDraft({ draftId: blockUuid, blockUuid })
      saveDraft(store, draft)

      const result = getDraftForNote(store, 'lib-abc', blockUuid)
      expect(result).toEqual(draft)
    })

    test('returns null when no draft exists for the note', () => {
      expect(getDraftForNote(store, 'lib-abc', 'non-existent')).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // getDraftsForPrefix
  // -----------------------------------------------------------------------

  describe('getDraftsForPrefix', () => {
    test('returns all drafts for the given prefix', () => {
      saveDraft(store, makeDraft({ draftId: 'd1' }))
      saveDraft(store, makeDraft({ draftId: 'd2' }))
      saveDraft(store, makeDraft({ draftId: 'd3', prefix: 'other-lib' }))

      const drafts = getDraftsForPrefix(store, 'lib-abc')
      expect(drafts).toHaveLength(2)
      const ids = drafts.map(d => d.draftId).sort()
      expect(ids).toEqual(['d1', 'd2'])
    })

    test('returns empty array when no drafts exist', () => {
      expect(getDraftsForPrefix(store, 'lib-abc')).toEqual([])
    })

    test('skips corrupted entries without affecting valid ones', () => {
      saveDraft(store, makeDraft({ draftId: 'good' }))
      // Write a corrupt entry
      store.setItem(draftKey('lib-abc', 'bad'), 'not json')

      const drafts = getDraftsForPrefix(store, 'lib-abc')
      expect(drafts).toHaveLength(1)
      expect(drafts[0].draftId).toBe('good')
    })

    test('does not return drafts from a different prefix that shares a key prefix', () => {
      // "lib-abc" should not pick up "lib-abcdef"
      saveDraft(store, makeDraft({ prefix: 'lib-abc', draftId: 'd1' }))
      saveDraft(store, makeDraft({ prefix: 'lib-abcdef', draftId: 'd2' }))

      const drafts = getDraftsForPrefix(store, 'lib-abc')
      expect(drafts).toHaveLength(1)
      expect(drafts[0].draftId).toBe('d1')
    })
  })

  // -----------------------------------------------------------------------
  // getDraftSummariesForCollection
  // -----------------------------------------------------------------------

  describe('getDraftSummariesForCollection', () => {
    test('filters drafts by collectionId (null = root)', () => {
      saveDraft(store, makeDraft({ draftId: 'root-draft', collectionId: null }))
      saveDraft(store, makeDraft({ draftId: 'col-draft', collectionId: 'col-1' }))

      const rootSummaries = getDraftSummariesForCollection(store, 'lib-abc', null)
      expect(rootSummaries).toHaveLength(1)
      expect(rootSummaries[0].draftId).toBe('root-draft')

      const colSummaries = getDraftSummariesForCollection(store, 'lib-abc', 'col-1')
      expect(colSummaries).toHaveLength(1)
      expect(colSummaries[0].draftId).toBe('col-draft')
    })

    test('returns empty array when no drafts match', () => {
      saveDraft(store, makeDraft({ draftId: 'd1', collectionId: 'col-x' }))

      const summaries = getDraftSummariesForCollection(store, 'lib-abc', 'col-y')
      expect(summaries).toHaveLength(0)
    })

    test('extracts title and slug from body', () => {
      saveDraft(store, makeDraft({ body: '# My Cool Note\n\nContent here.' }))

      const summaries = getDraftSummariesForCollection(store, 'lib-abc', null)
      expect(summaries).toHaveLength(1)
      expect(summaries[0].title).toBe('My Cool Note')
      expect(summaries[0].slug).toBe('my-cool-note')
    })

    test('returns null title and slug when body has no heading', () => {
      saveDraft(store, makeDraft({ body: 'No heading here.' }))

      const summaries = getDraftSummariesForCollection(store, 'lib-abc', null)
      expect(summaries).toHaveLength(1)
      expect(summaries[0].title).toBeNull()
      expect(summaries[0].slug).toBeNull()
    })

    test('does not include the body in the summary', () => {
      saveDraft(store, makeDraft({ body: '# Title\n\nLong body...' }))

      const summaries = getDraftSummariesForCollection(store, 'lib-abc', null)
      expect(summaries).toHaveLength(1)
      // DraftSummary has no body field
      expect((summaries[0] as any).body).toBeUndefined()
    })
  })

  // -----------------------------------------------------------------------
  // getBlockUuidsWithDrafts
  // -----------------------------------------------------------------------

  describe('getBlockUuidsWithDrafts', () => {
    test('returns set of blockUuids for existing-note drafts', () => {
      saveDraft(store, makeDraft({ draftId: 'b1', blockUuid: 'b1' }))
      saveDraft(store, makeDraft({ draftId: 'b2', blockUuid: 'b2' }))
      // New-note draft (blockUuid is null)
      saveDraft(store, makeDraft({ draftId: 'new-1', blockUuid: null }))

      const uuids = getBlockUuidsWithDrafts(store, 'lib-abc')
      expect(uuids.size).toBe(2)
      expect(uuids.has('b1')).toBe(true)
      expect(uuids.has('b2')).toBe(true)
    })

    test('returns empty set when no drafts exist', () => {
      const uuids = getBlockUuidsWithDrafts(store, 'lib-abc')
      expect(uuids.size).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // deleteAllDraftsForPrefix
  // -----------------------------------------------------------------------

  describe('deleteAllDraftsForPrefix', () => {
    test('removes all drafts for the given prefix', () => {
      saveDraft(store, makeDraft({ draftId: 'd1' }))
      saveDraft(store, makeDraft({ draftId: 'd2' }))
      saveDraft(store, makeDraft({ draftId: 'd3', prefix: 'other-lib' }))

      deleteAllDraftsForPrefix(store, 'lib-abc')

      expect(getDraftsForPrefix(store, 'lib-abc')).toHaveLength(0)
      // Other prefix should be untouched
      expect(getDraftsForPrefix(store, 'other-lib')).toHaveLength(1)
    })

    test('does not throw when there are no drafts to delete', () => {
      expect(() => deleteAllDraftsForPrefix(store, 'empty-lib')).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // draftToSummary
  // -----------------------------------------------------------------------

  describe('draftToSummary', () => {
    test('extracts title and slug from body', () => {
      const draft = makeDraft({ body: '# Hello World\n\nContent.' })
      const summary = draftToSummary(draft)

      expect(summary.draftId).toBe(draft.draftId)
      expect(summary.blockUuid).toBe(draft.blockUuid)
      expect(summary.collectionId).toBe(draft.collectionId)
      expect(summary.prefix).toBe(draft.prefix)
      expect(summary.title).toBe('Hello World')
      expect(summary.slug).toBe('hello-world')
      expect(summary.updatedAt).toBe(draft.updatedAt)
    })

    test('returns null title and slug for body without heading', () => {
      const draft = makeDraft({ body: 'Just text, no heading.' })
      const summary = draftToSummary(draft)

      expect(summary.title).toBeNull()
      expect(summary.slug).toBeNull()
    })

    test('handles empty body', () => {
      const draft = makeDraft({ body: '' })
      const summary = draftToSummary(draft)

      expect(summary.title).toBeNull()
      expect(summary.slug).toBeNull()
    })
  })

  // -----------------------------------------------------------------------
  // Error resilience
  // -----------------------------------------------------------------------

  describe('error resilience', () => {
    test('saveDraft swallows errors from a failing store', () => {
      const failStore: DraftStore = {
        getItem: () => null,
        setItem: () => { throw new Error('disk full') },
        removeItem: () => {},
        keys: () => [],
      }

      // Should not throw
      expect(() => saveDraft(failStore, makeDraft())).not.toThrow()
    })

    test('getDraftsForPrefix swallows errors from a failing store', () => {
      const failStore: DraftStore = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        keys: () => { throw new Error('unavailable') },
      }

      expect(getDraftsForPrefix(failStore, 'lib-abc')).toEqual([])
    })

    test('deleteAllDraftsForPrefix swallows errors from a failing store', () => {
      const failStore: DraftStore = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => { throw new Error('permission denied') },
        keys: () => ['scribe:draft:lib-abc:d1'],
      }

      expect(() => deleteAllDraftsForPrefix(failStore, 'lib-abc')).not.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // MemoryDraftStore
  // -----------------------------------------------------------------------

  describe('MemoryDraftStore', () => {
    test('getItem returns null for missing keys', () => {
      expect(store.getItem('missing')).toBeNull()
    })

    test('setItem and getItem round-trip a value', () => {
      store.setItem('k', 'v')
      expect(store.getItem('k')).toBe('v')
    })

    test('removeItem deletes a key', () => {
      store.setItem('k', 'v')
      store.removeItem('k')
      expect(store.getItem('k')).toBeNull()
    })

    test('keys returns all stored keys', () => {
      store.setItem('a', '1')
      store.setItem('b', '2')
      expect(store.keys().sort()).toEqual(['a', 'b'])
    })

    test('removeItem on missing key does not throw', () => {
      expect(() => store.removeItem('nope')).not.toThrow()
    })
  })
})
