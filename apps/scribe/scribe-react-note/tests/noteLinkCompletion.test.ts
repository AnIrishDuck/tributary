import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import {
  detectLinkContext,
  resolvePartialSlugToSegments,
  buildSlugApplyText,
  buildSlugCompletion,
} from '../src/extensions/noteLinkCompletion'

/**
 * Helper: create a CompletionContext at the given cursor position in a document.
 */
function makeCtx(doc: string, pos: number, explicit = false): CompletionContext {
  const state = EditorState.create({ doc })
  return new CompletionContext(state, pos, explicit)
}

describe('detectLinkContext', () => {
  it('detects wikilink context after [[', () => {
    const ctx = makeCtx('Hello [[My N', 12)
    const result = detectLinkContext(ctx)
    expect(result).toEqual({ type: 'wikilink', prefix: 'My N', from: 8 })
  })

  it('detects wikilink with empty prefix right after [[', () => {
    const ctx = makeCtx('Hello [[', 8)
    const result = detectLinkContext(ctx)
    expect(result).toEqual({ type: 'wikilink', prefix: '', from: 8 })
  })

  it('returns null for wikilink after pipe (display text)', () => {
    const ctx = makeCtx('Hello [[Title|disp', 18)
    const result = detectLinkContext(ctx)
    expect(result).toBeNull()
  })

  it('returns null for closed wikilink', () => {
    const ctx = makeCtx('Hello [[Title]] after', 20)
    const result = detectLinkContext(ctx)
    expect(result).toBeNull()
  })

  it('detects markdown link target context', () => {
    const ctx = makeCtx('See [my link](cook', 18)
    const result = detectLinkContext(ctx)
    expect(result).toEqual({ type: 'markdown-link', prefix: 'cook', from: 14 })
  })

  it('detects markdown link with empty prefix', () => {
    const ctx = makeCtx('See [my link](', 14)
    const result = detectLinkContext(ctx)
    expect(result).toEqual({ type: 'markdown-link', prefix: '', from: 14 })
  })

  it('returns null for closed markdown link', () => {
    const ctx = makeCtx('See [my link](target) after', 26)
    const result = detectLinkContext(ctx)
    expect(result).toBeNull()
  })

  it('returns null for plain text', () => {
    const ctx = makeCtx('Just some plain text', 20)
    const result = detectLinkContext(ctx)
    expect(result).toBeNull()
  })

  it('detects markdown link with relative path', () => {
    const ctx = makeCtx('[link](./sib', 12)
    const result = detectLinkContext(ctx)
    expect(result).toEqual({ type: 'markdown-link', prefix: './sib', from: 7 })
  })

  it('detects markdown link with path segments', () => {
    const ctx = makeCtx('[link](cooking/ital', 19)
    const result = detectLinkContext(ctx)
    expect(result).toEqual({ type: 'markdown-link', prefix: 'cooking/ital', from: 7 })
  })
})

describe('resolvePartialSlugToSegments', () => {
  it('handles bare slug', () => {
    expect(resolvePartialSlugToSegments('cook')).toEqual(['cook'])
  })

  it('handles bare slug with path', () => {
    expect(resolvePartialSlugToSegments('cooking/ital')).toEqual(['cooking', 'ital'])
  })

  it('handles bare slug ending with slash', () => {
    expect(resolvePartialSlugToSegments('cooking/')).toEqual(['cooking', ''])
  })

  it('handles absolute path', () => {
    expect(resolvePartialSlugToSegments('/cooking/ital')).toEqual(['cooking', 'ital'])
  })

  it('handles relative ./ path with noteSlugPath', () => {
    const result = resolvePartialSlugToSegments('./sib', 'cooking/italian/pasta')
    // collection = ['cooking', 'italian'], resolve ./ → same, then add 'sib'
    expect(result).toEqual(['cooking', 'italian', 'sib'])
  })

  it('handles relative ../ path with noteSlugPath', () => {
    const result = resolvePartialSlugToSegments('../fr', 'cooking/italian/pasta')
    // collection = ['cooking', 'italian'], .. pops 'italian', then add 'fr'
    expect(result).toEqual(['cooking', 'fr'])
  })

  it('handles ./ ending with slash (browse collection)', () => {
    const result = resolvePartialSlugToSegments('./', 'cooking/italian/pasta')
    // collection = ['cooking', 'italian'], ./ stays, trailing / adds empty prefix
    expect(result).toEqual(['cooking', 'italian', ''])
  })

  it('returns null for relative path without noteSlugPath', () => {
    expect(resolvePartialSlugToSegments('./foo')).toBeNull()
  })

  it('returns null for ../ that navigates above root', () => {
    const result = resolvePartialSlugToSegments('../../foo', 'single-note')
    // collection = [], .. fails since empty
    expect(result).toBeNull()
  })

  it('handles multiple ../ segments', () => {
    const result = resolvePartialSlugToSegments('../../other', 'a/b/c/note')
    // collection = ['a', 'b', 'c'], ../.. pops 'c' and 'b', then add 'other'
    expect(result).toEqual(['a', 'other'])
  })
})

describe('buildSlugApplyText', () => {
  it('returns full slug path for bare slugs', () => {
    const result = buildSlugApplyText(
      { slug_path: 'cooking/italian/pasta', title: 'Pasta', type: 'note' },
      'cook',
    )
    expect(result).toBe('cooking/italian/pasta')
  })

  it('returns /prefixed path for absolute slugs', () => {
    const result = buildSlugApplyText(
      { slug_path: 'cooking/italian/pasta', title: 'Pasta', type: 'note' },
      '/cook',
    )
    expect(result).toBe('/cooking/italian/pasta')
  })

  it('returns relative path for ./ prefix', () => {
    const result = buildSlugApplyText(
      { slug_path: 'cooking/italian/risotto', title: 'Risotto', type: 'note' },
      './ris',
      'cooking/italian/pasta',
    )
    expect(result).toBe('./risotto')
  })

  it('returns relative path for ../ prefix', () => {
    const result = buildSlugApplyText(
      { slug_path: 'cooking/french', title: 'French', type: 'collection' },
      '../fr',
      'cooking/italian/pasta',
    )
    expect(result).toBe('../french')
  })
})

describe('buildSlugCompletion', () => {
  it('uses slug as label for markdown link completions, not title', () => {
    const completion = buildSlugCompletion(
      { slug_path: 'my-fancy-title', title: 'My Fancy Title', type: 'note' },
      'my',
    )
    // Label must be the slug (what gets inserted), not the human title
    expect(completion.label).toBe('my-fancy-title')
    // Title shown as secondary detail for context
    expect(completion.detail).toBe('My Fancy Title')
    expect(completion.type).toBe('note')
  })

  it('uses relative slug as label for ./ paths', () => {
    const completion = buildSlugCompletion(
      { slug_path: 'cooking/italian/risotto', title: 'Risotto', type: 'note' },
      './ris',
      'cooking/italian/pasta',
    )
    expect(completion.label).toBe('./risotto')
    expect(completion.detail).toBe('Risotto')
  })

  it('uses absolute slug as label for / paths', () => {
    const completion = buildSlugCompletion(
      { slug_path: 'cooking/italian/pasta', title: 'Pasta', type: 'note' },
      '/cook',
    )
    expect(completion.label).toBe('/cooking/italian/pasta')
    expect(completion.detail).toBe('Pasta')
  })

  it('uses nested slug path as label for bare multi-segment paths', () => {
    const completion = buildSlugCompletion(
      { slug_path: 'cooking/italian/pasta', title: 'Pasta', type: 'note' },
      'cooking/ital',
    )
    expect(completion.label).toBe('cooking/italian/pasta')
    expect(completion.detail).toBe('Pasta')
  })
})
