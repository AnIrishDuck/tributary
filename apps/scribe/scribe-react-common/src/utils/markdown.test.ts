import { describe, it, expect } from 'vitest'
import { resolveSlugLinksInHtml, renderMarkdown } from './markdown'

const testPrefix = '_ip1xGnAiIyjoI2RRX5xmAVei607S-s3rvTmEgFQ-k0'

describe('resolveSlugLinksInHtml', () => {
  it('should resolve slug links in anchor tags', () => {
    const html = '<p><a href="my-note">My Note</a></p>'
    const result = resolveSlugLinksInHtml(html, testPrefix)
    expect(result).toBe(`<p><a href="/#/pk/${testPrefix}/my-note">My Note</a></p>`)
  })

  it('should leave external links unchanged', () => {
    const html = '<p><a href="https://example.com">Example</a></p>'
    const result = resolveSlugLinksInHtml(html, testPrefix)
    expect(result).toBe(html)
  })

  it('should leave mailto links unchanged', () => {
    const html = '<p><a href="mailto:test@example.com">Email</a></p>'
    const result = resolveSlugLinksInHtml(html, testPrefix)
    expect(result).toBe(html)
  })

  it('should resolve multiple slug links', () => {
    const html = '<p><a href="note-a">A</a> and <a href="note-b">B</a></p>'
    const result = resolveSlugLinksInHtml(html, testPrefix)
    expect(result).toContain(`href="/#/pk/${testPrefix}/note-a"`)
    expect(result).toContain(`href="/#/pk/${testPrefix}/note-b"`)
  })

  it('should handle mixed slug and external links', () => {
    const html = '<p><a href="my-note">Note</a> and <a href="https://example.com">Ext</a></p>'
    const result = resolveSlugLinksInHtml(html, testPrefix)
    expect(result).toContain(`href="/#/pk/${testPrefix}/my-note"`)
    expect(result).toContain('href="https://example.com"')
  })

  it('should resolve relative links with current slug', () => {
    const html = '<p><a href="./sibling">Sibling</a></p>'
    const result = resolveSlugLinksInHtml(html, testPrefix, 'current-note')
    expect(result).toContain(`href="/#/pk/${testPrefix}/sibling"`)
  })

  it('should not modify already-resolved links', () => {
    const resolved = `/#/pk/${testPrefix}/my-note`
    const html = `<p><a href="${resolved}">Note</a></p>`
    const result = resolveSlugLinksInHtml(html, testPrefix)
    expect(result).toBe(html)
  })

  it('should not modify non-link HTML', () => {
    const html = '<p>Just some text</p>'
    const result = resolveSlugLinksInHtml(html, testPrefix)
    expect(result).toBe(html)
  })

  it('should use routeBase when provided', () => {
    const html = '<p><a href="my-note">My Note</a></p>'
    const result = resolveSlugLinksInHtml(html, testPrefix, undefined, '/n/my-library')
    expect(result).toBe('<p><a href="/#/n/my-library/my-note">My Note</a></p>')
  })

  it('should resolve absolute internal links to /#/ paths', () => {
    const html = '<p><a href="#pk/other-key/note">Cross-lib Note</a></p>'
    const result = resolveSlugLinksInHtml(html, testPrefix)
    expect(result).toBe('<p><a href="/#/pk/other-key/note">Cross-lib Note</a></p>')
  })

  it('should resolve #n/ absolute internal links', () => {
    const html = '<p><a href="#n/recipes/soup">Soup Recipe</a></p>'
    const result = resolveSlugLinksInHtml(html, testPrefix, undefined, '/n/my-library')
    expect(result).toBe('<p><a href="/#/n/recipes/soup">Soup Recipe</a></p>')
  })

  it('should resolve absolute internal links even when routeBase is set', () => {
    const html = '<p><a href="#pk/abc123/note">Note</a> and <a href="local">Local</a></p>'
    const result = resolveSlugLinksInHtml(html, testPrefix, undefined, '/n/my-library')
    expect(result).toContain('href="/#/pk/abc123/note"')
    expect(result).toContain('href="/#/n/my-library/local"')
  })
})

describe('renderMarkdown', () => {
  it('should render basic markdown', () => {
    const result = renderMarkdown('# Hello', testPrefix)
    expect(result).toContain('<h1>Hello</h1>')
  })

  it('should resolve slug links during rendering', () => {
    const result = renderMarkdown('[My Note](my-note)', testPrefix)
    expect(result).toContain(`href="/#/pk/${testPrefix}/my-note"`)
    expect(result).toContain('>My Note</a>')
  })

  it('should preserve external links during rendering', () => {
    const result = renderMarkdown('[Example](https://example.com)', testPrefix)
    expect(result).toContain('href="https://example.com"')
  })

  it('should support GFM strikethrough', () => {
    const result = renderMarkdown('~~deleted~~', testPrefix)
    expect(result).toContain('<del>deleted</del>')
  })

  it('should support GFM tables', () => {
    const md = '| a | b |\n| - | - |\n| 1 | 2 |'
    const result = renderMarkdown(md, testPrefix)
    expect(result).toContain('<table>')
    expect(result).toContain('<td>1</td>')
  })

  it('should support GFM task lists', () => {
    const md = '- [x] done\n- [ ] todo'
    const result = renderMarkdown(md, testPrefix)
    expect(result).toContain('checked=""')
    expect(result).toContain('type="checkbox"')
  })

  it('should support GFM autolinks', () => {
    const result = renderMarkdown('Visit https://example.com today', testPrefix)
    expect(result).toContain('<a href="https://example.com">')
  })

  it('should handle slug links inside GFM tables', () => {
    const md = '| Link |\n| - |\n| [Note](my-note) |'
    const result = renderMarkdown(md, testPrefix)
    expect(result).toContain(`href="/#/pk/${testPrefix}/my-note"`)
  })

  it('should use routeBase for slug link resolution', () => {
    const result = renderMarkdown('[My Note](my-note)', testPrefix, undefined, '/n/recipes')
    expect(result).toContain('href="/#/n/recipes/my-note"')
    expect(result).toContain('>My Note</a>')
  })

  it('should preserve already-resolved /#pk/ links in markdown', () => {
    const result = renderMarkdown('[Cross-lib](/#pk/other-key/note)', testPrefix)
    // Already-resolved links (starting with /#) should pass through unchanged
    expect(result).toContain('href="/#pk/other-key/note"')
  })

  it('should preserve already-resolved /#n/ links in markdown', () => {
    const result = renderMarkdown('[Recipes](/#n/recipes/soup)', testPrefix, undefined, '/n/my-library')
    expect(result).toContain('href="/#n/recipes/soup"')
  })
})
