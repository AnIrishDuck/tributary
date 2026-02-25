import { test, expect, describe } from 'vitest'
import { resolveLink } from '../src/link.js'

describe('resolveLink', () => {
  describe('bare links (no prefix)', () => {
    test('resolves bare link relative to collection', () => {
      const result = resolveLink('/a', 'b')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/b' })
    })

    test('resolves bare link in nested collection', () => {
      const result = resolveLink('/a/b', 'c')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/b/c' })
    })

    test('resolves bare multi-segment link', () => {
      const result = resolveLink('/a', 'b/c')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/b/c' })
    })
  })

  describe('explicit relative links (./)', () => {
    test('resolves ./ link relative to collection', () => {
      const result = resolveLink('/a', './b')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/b' })
    })

    test('resolves ./ link in nested collection', () => {
      const result = resolveLink('/a/b', './c')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/b/c' })
    })

    test('resolves ./ multi-segment link', () => {
      const result = resolveLink('/a', './b/c/d')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/b/c/d' })
    })
  })

  describe('absolute links (/)', () => {
    test('resolves absolute link from root', () => {
      const result = resolveLink('/a', '/b')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/b' })
    })

    test('ignores collection for absolute links', () => {
      const result = resolveLink('/deeply/nested/collection', '/top')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/top' })
    })

    test('resolves absolute multi-segment link', () => {
      const result = resolveLink('/a', '/b/c/d')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/b/c/d' })
    })

    test('resolves bare root link to root', () => {
      const result = resolveLink('/a', '/')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/' })
    })

    test('resolves root link from nested collection', () => {
      const result = resolveLink('/a/b/c', '/')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/' })
    })
  })

  describe('parent traversal (../)', () => {
    test('resolves ../ to parent collection', () => {
      const result = resolveLink('/a', '../c')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/c' })
    })

    test('resolves ../ in deeply nested collection', () => {
      const result = resolveLink('/a/b/c', '../d')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/b/d' })
    })

    test('resolves multiple ../ traversals', () => {
      const result = resolveLink('/a/b/c', '../../d')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/d' })
    })

    test('returns InvalidLink when traversing above root', () => {
      const result = resolveLink('/a', '../../c')
      expect(result).toEqual({ type: 'InvalidLink' })
    })

    test('returns InvalidLink when deeply traversing above root', () => {
      const result = resolveLink('/a/b', '../../../c')
      expect(result).toEqual({ type: 'InvalidLink' })
    })

    test('resolves ../ to root level', () => {
      const result = resolveLink('/a/b', '../../c')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/c' })
    })

    test('resolves ../ with multi-segment suffix', () => {
      const result = resolveLink('/a/b', '../c/d')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/c/d' })
    })
  })

  describe('edge cases', () => {
    test('returns InvalidLink for empty link', () => {
      const result = resolveLink('/a', '')
      expect(result).toEqual({ type: 'InvalidLink' })
    })

    test('resolves link from root collection', () => {
      const result = resolveLink('/', 'a')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a' })
    })

    test('returns InvalidLink when ../ from root collection', () => {
      const result = resolveLink('/', '../a')
      expect(result).toEqual({ type: 'InvalidLink' })
    })

    test('resolves mixed ../ and segments in link', () => {
      const result = resolveLink('/a/b', './c/../d')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/b/d' })
    })

    test('resolves ./ that navigates back to collection itself then down', () => {
      const result = resolveLink('/a/b', '../b/c')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/a/b/c' })
    })

    test('resolves ../ to root when at top-level collection', () => {
      const result = resolveLink('/a', '..')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/' })
    })

    test('resolves ../ to root from nested collection', () => {
      const result = resolveLink('/a/b', '../../')
      expect(result).toEqual({ type: 'AbsoluteLink', path: '/' })
    })
  })
})
