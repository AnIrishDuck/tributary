import { describe, it, expect, beforeEach } from 'vitest'
import { 
  isSlugLink, 
  resolveSlugLink, 
  resolveLink,
  extractStreamPrefixFromUrl,
  extractSlugFromUrl,
  isResolvedBlockUrl
} from './links'

describe('Link Utilities', () => {
  const testStreamPrefix = '_ip1xGnAiIyjoI2RRX5xmAVei607S-s3rvTmEgFQ-k0'
  
  describe('isSlugLink', () => {
    it('should return true for links without protocol', () => {
      expect(isSlugLink('link-target')).toBe(true)
      expect(isSlugLink('another-link')).toBe(true)
      expect(isSlugLink('#some-slug')).toBe(true)
      expect(isSlugLink('test')).toBe(true)
      expect(isSlugLink('./relative')).toBe(true)
      expect(isSlugLink('../parent/relative')).toBe(true)
    })
    
    it('should return false for links with http protocol', () => {
      expect(isSlugLink('http://example.com')).toBe(false)
      expect(isSlugLink('http://localhost:3000')).toBe(false)
    })
    
    it('should return false for links with https protocol', () => {
      expect(isSlugLink('https://example.com')).toBe(false)
      expect(isSlugLink('https://example.com/path')).toBe(false)
    })
    
    it('should return false for mailto links', () => {
      expect(isSlugLink('mailto:test@example.com')).toBe(false)
    })
    
    it('should return false for tel links', () => {
      expect(isSlugLink('tel:+1234567890')).toBe(false)
    })
    
    it('should return false for protocol-relative URLs', () => {
      expect(isSlugLink('//example.com')).toBe(false)
    })
    
    it('should return false for already resolved URLs starting with #/', () => {
      expect(isSlugLink('#/pk/some-key/link')).toBe(false)
    })
    
    it('should return false for already resolved URLs starting with /#', () => {
      expect(isSlugLink('/#/pk/some-key/link')).toBe(false)
    })
  })
  
  describe('isResolvedBlockUrl', () => {
    it('should return true for already resolved URLs', () => {
      expect(isResolvedBlockUrl('#/pk/some-key/link')).toBe(true)
      expect(isResolvedBlockUrl('/#/pk/some-key/link')).toBe(true)
    })
    
    it('should return false for unresolved links', () => {
      expect(isResolvedBlockUrl('link')).toBe(false)
      expect(isResolvedBlockUrl('#section')).toBe(false)
      expect(isResolvedBlockUrl('https://example.com')).toBe(false)
    })
  })
  
  describe('resolveSlugLink', () => {
    it('should resolve a simple slug to a block URL', () => {
      const result = resolveSlugLink('link-target', testStreamPrefix)
      expect(result).toBe(`/#/pk/${testStreamPrefix}/link-target`)
    })
    
    it('should handle links with leading hash', () => {
      const result = resolveSlugLink('#link-target', testStreamPrefix)
      expect(result).toBe(`/#/pk/${testStreamPrefix}/link-target`)
    })
    
    it('should preserve external links', () => {
      const result = resolveSlugLink('https://example.com', testStreamPrefix)
      expect(result).toBe('https://example.com')
    })
    
    it('should handle special characters in slug', () => {
      const result = resolveSlugLink('my-special-link_123', testStreamPrefix)
      expect(result).toBe(`/#/pk/${testStreamPrefix}/my-special-link_123`)
    })
  })
  
  describe('resolveLink', () => {
    const testSlug = 'current-document'
    
    it('should resolve a simple slug link', () => {
      const result = resolveLink('other-document', testStreamPrefix, testSlug)
      expect(result).toBe(`/#/pk/${testStreamPrefix}/other-document`)
    })
    
    it('should preserve external links', () => {
      const result = resolveLink('https://example.com', testStreamPrefix, testSlug)
      expect(result).toBe('https://example.com')
    })
    
    it('should resolve relative links with ./ prefix (same level)', () => {
      const result = resolveLink('./sibling-document', testStreamPrefix, testSlug)
      expect(result).toBe(`/#/pk/${testStreamPrefix}/sibling-document`)
    })
    
    it('should resolve relative links with ../ prefix (parent level)', () => {
      const result = resolveLink('../parent-document', testStreamPrefix, 'child/grandchild')
      expect(result).toBe(`/#/pk/${testStreamPrefix}/child/parent-document`)
    })
    
    it('should handle nested relative links', () => {
      const result = resolveLink('../sibling/other', testStreamPrefix, 'parent/child')
      expect(result).toBe(`/#/pk/${testStreamPrefix}/parent/sibling/other`)
    })
    
    it('should work without currentSlug for simple slugs', () => {
      const result = resolveLink('simple-slug', testStreamPrefix)
      expect(result).toBe(`/#/pk/${testStreamPrefix}/simple-slug`)
    })
    
    it('should preserve protocol-relative URLs', () => {
      const result = resolveLink('//cdn.example.com/file.js', testStreamPrefix, testSlug)
      expect(result).toBe('//cdn.example.com/file.js')
    })
    
    it('should not double-resolve already resolved URLs', () => {
      const alreadyResolved = `/#/pk/${testStreamPrefix}/link-target`
      const result = resolveLink(alreadyResolved, testStreamPrefix, testSlug)
      expect(result).toBe(alreadyResolved)
    })
    
    it('should be idempotent - resolving twice gives same result', () => {
      const original = 'link-target'
      const firstResolve = resolveLink(original, testStreamPrefix, testSlug)
      const secondResolve = resolveLink(firstResolve, testStreamPrefix, testSlug)
      expect(secondResolve).toBe(firstResolve)
    })
  })
  
  describe('extractStreamPrefixFromUrl', () => {
    it('should extract stream prefix from a block URL', () => {
      const url = `/#/pk/${testStreamPrefix}/document-slug`
      const prefix = extractStreamPrefixFromUrl(url)
      expect(prefix).toBe(testStreamPrefix)
    })
    
    it('should return null for invalid URLs', () => {
      expect(extractStreamPrefixFromUrl('https://example.com')).toBeNull()
      expect(extractStreamPrefixFromUrl('/invalid/url')).toBeNull()
      expect(extractStreamPrefixFromUrl('')).toBeNull()
    })
    
    it('should handle URLs with query params', () => {
      const url = `/#/pk/${testStreamPrefix}/document?param=value`
      const prefix = extractStreamPrefixFromUrl(url)
      expect(prefix).toBe(testStreamPrefix)
    })
    
    it('should handle URLs with hash fragments', () => {
      const url = `/#/pk/${testStreamPrefix}/document#section`
      const prefix = extractStreamPrefixFromUrl(url)
      expect(prefix).toBe(testStreamPrefix)
    })
  })
  
  describe('extractSlugFromUrl', () => {
    it('should extract slug from a block URL', () => {
      const url = `/#/pk/${testStreamPrefix}/document-slug`
      const slug = extractSlugFromUrl(url)
      expect(slug).toBe('document-slug')
    })
    
    it('should handle URLs with query params', () => {
      const url = `/#/pk/${testStreamPrefix}/document?param=value`
      const slug = extractSlugFromUrl(url)
      expect(slug).toBe('document')
    })
    
    it('should handle URLs with hash fragments', () => {
      const url = `/#/pk/${testStreamPrefix}/document#section`
      const slug = extractSlugFromUrl(url)
      expect(slug).toBe('document')
    })
    
    it('should return null for invalid URLs', () => {
      expect(extractSlugFromUrl('https://example.com')).toBeNull()
      expect(extractSlugFromUrl('/invalid/url')).toBeNull()
      expect(extractSlugFromUrl('')).toBeNull()
    })
  })
})
