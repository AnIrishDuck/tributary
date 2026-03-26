import { describe, it, expect } from 'vitest'
import { resolveSlugLinksInHtml, resolveWikilinksInHtml, renderMarkdown } from './markdown'
import type { ScribePlugin } from '../plugins/types'
import type { HtmlExtension } from 'micromark-util-types'
import type { LinkStatusMap } from './linkValidation'

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

describe('resolveWikilinksInHtml', () => {
  it('should resolve wikilink: URLs to &titled routes', () => {
    const html = '<a href="wikilink:My Note" class="wikilink">My Note</a>'
    const result = resolveWikilinksInHtml(html, '/n/my-library')
    expect(result).toBe('<a href="/#/n/my-library/&titled?t=My%20Note" class="wikilink">My Note</a>')
  })

  it('should encode title for URL', () => {
    const html = '<a href="wikilink:Note &amp; More" class="wikilink">Note &amp; More</a>'
    const result = resolveWikilinksInHtml(html, '/pk/abc')
    expect(result).toContain('&titled?t=Note%20%26%20More')
  })

  it('should not modify non-wikilink anchors', () => {
    const html = '<a href="https://example.com">Example</a>'
    const result = resolveWikilinksInHtml(html, '/pk/abc')
    expect(result).toBe(html)
  })
})

describe('renderMarkdown with wikilinks', () => {
  it('should render [[Title]] as &titled link', () => {
    const result = renderMarkdown('[[My Note]]', testPrefix)
    expect(result).toContain(`href="/#/pk/${testPrefix}/&titled?t=My%20Note"`)
    expect(result).toContain('class="wikilink"')
    expect(result).toContain('>My Note</a>')
  })

  it('should render [[Title|Display]] with display text', () => {
    const result = renderMarkdown('[[My Note|click here]]', testPrefix)
    expect(result).toContain(`href="/#/pk/${testPrefix}/&titled?t=My%20Note"`)
    expect(result).toContain('>click here</a>')
  })

  it('should use routeBase for wikilink resolution', () => {
    const result = renderMarkdown('[[My Note]]', testPrefix, undefined, '/n/recipes')
    expect(result).toContain('href="/#/n/recipes/&titled?t=My%20Note"')
  })

  it('should render wikilinks alongside regular links', () => {
    const result = renderMarkdown('[[Wiki]] and [Regular](slug)', testPrefix)
    expect(result).toContain('class="wikilink"')
    expect(result).toContain(`/#/pk/${testPrefix}/slug`)
  })

  it('should not parse empty wikilinks', () => {
    const result = renderMarkdown('[[]]', testPrefix)
    expect(result).not.toContain('wikilink')
  })
})

describe('renderMarkdown with plugins', () => {
  function makePlugin(overrides: Partial<ScribePlugin>): ScribePlugin {
    return { name: 'test-plugin', apiVersion: 1, ...overrides }
  }

  it('should apply plugin micromark extensions', () => {
    // Use a micromark HTML extension that wraps <code> in <mark>.
    const htmlExt: HtmlExtension = {
      enter: { codeText() { this.tag('<mark>'); return undefined } },
      exit: { codeText() { this.tag('</mark>'); return undefined } }
    }
    const plugin = makePlugin({
      micromark: { htmlExtensions: [htmlExt] }
    })
    const result = renderMarkdown('`hello`', testPrefix, undefined, undefined, [plugin])
    expect(result).toContain('<mark>')
    expect(result).toContain('</mark>')
  })

  it('should apply plugin HTML extensions', () => {
    const htmlExt: HtmlExtension = {
      enter: { emphasis() { this.tag('<em class="plugin">'); return undefined } }
    }
    const plugin = makePlugin({
      micromark: { htmlExtensions: [htmlExt] }
    })
    const result = renderMarkdown('*emphasized*', testPrefix, undefined, undefined, [plugin])
    expect(result).toContain('<em class="plugin">')
  })

  it('should call transformHtml in plugin order', () => {
    const plugin1 = makePlugin({
      name: 'plugin-1',
      transformHtml: (html) => html.replace('Hello', 'Hello from 1')
    })
    const plugin2 = makePlugin({
      name: 'plugin-2',
      transformHtml: (html) => html.replace('Hello from 1', 'Hello from 1 and 2')
    })
    const result = renderMarkdown('Hello', testPrefix, undefined, undefined, [plugin1, plugin2])
    expect(result).toContain('Hello from 1 and 2')
  })

  it('should compose multiple plugins extensions correctly', () => {
    const htmlExt: HtmlExtension = {
      enter: { codeText() { this.tag('<mark>'); return undefined } },
      exit: { codeText() { this.tag('</mark>'); return undefined } }
    }
    const plugin1 = makePlugin({
      name: 'plugin-1',
      micromark: { htmlExtensions: [htmlExt] }
    })
    const plugin2 = makePlugin({
      name: 'plugin-2',
      transformHtml: (html) => html.replace('<mark>', '<mark class="highlight">')
    })
    const result = renderMarkdown('`code`', testPrefix, undefined, undefined, [plugin1, plugin2])
    expect(result).toContain('<mark class="highlight">')
    expect(result).toContain('</mark>')
  })

  it('should not change behavior when no plugins provided', () => {
    const withoutPlugins = renderMarkdown('# Hello\n\n[link](my-note)', testPrefix)
    const withEmptyPlugins = renderMarkdown('# Hello\n\n[link](my-note)', testPrefix, undefined, undefined, [])
    expect(withEmptyPlugins).toBe(withoutPlugins)
  })

  it('should apply transformHtml after slug link resolution', () => {
    const plugin = makePlugin({
      transformHtml: (html) => {
        // Verify slug links are already resolved when transformHtml runs
        if (html.includes(`/#/pk/${testPrefix}/my-note`)) {
          return html.replace('<p>', '<p class="transformed">')
        }
        return html
      }
    })
    const result = renderMarkdown('[link](my-note)', testPrefix, undefined, undefined, [plugin])
    expect(result).toContain('<p class="transformed">')
    expect(result).toContain(`/#/pk/${testPrefix}/my-note`)
  })
})

describe('resolveSlugLinksInHtml with link statuses', () => {
  it('should add broken style to broken slug links', () => {
    const html = '<p><a href="missing-note">Missing</a></p>'
    const statuses: LinkStatusMap = new Map([['missing-note', 'broken']])
    const result = resolveSlugLinksInHtml(html, testPrefix, undefined, undefined, statuses)
    expect(result).toContain('class="link-broken"')
    expect(result).toContain('color: #dc2626')
  })

  it('should add conflict style to conflict slug links', () => {
    const html = '<p><a href="dupe-note">Dupe</a></p>'
    const statuses: LinkStatusMap = new Map([['dupe-note', 'conflict']])
    const result = resolveSlugLinksInHtml(html, testPrefix, undefined, undefined, statuses)
    expect(result).toContain('class="link-conflict"')
    expect(result).toContain('color: #d97706')
  })

  it('should not add attrs to ok slug links', () => {
    const html = '<p><a href="good-note">Good</a></p>'
    const statuses: LinkStatusMap = new Map([['good-note', 'ok']])
    const result = resolveSlugLinksInHtml(html, testPrefix, undefined, undefined, statuses)
    expect(result).not.toContain('class=')
    expect(result).not.toContain('style=')
  })

  it('should not add attrs to links not in the map', () => {
    const html = '<p><a href="unknown">Unknown</a></p>'
    const statuses: LinkStatusMap = new Map()
    const result = resolveSlugLinksInHtml(html, testPrefix, undefined, undefined, statuses)
    expect(result).not.toContain('class=')
    expect(result).not.toContain('style=')
  })

  it('should not affect external links', () => {
    const html = '<p><a href="https://example.com">Ext</a></p>'
    const statuses: LinkStatusMap = new Map([['https://example.com', 'broken']])
    const result = resolveSlugLinksInHtml(html, testPrefix, undefined, undefined, statuses)
    expect(result).not.toContain('class=')
  })
})

describe('resolveWikilinksInHtml with link statuses', () => {
  it('should add broken style to broken wikilinks', () => {
    const html = '<a href="wikilink:Missing Note" class="wikilink">Missing Note</a>'
    const statuses: LinkStatusMap = new Map([['wikilink:Missing Note', 'broken']])
    const result = resolveWikilinksInHtml(html, '/pk/abc', statuses)
    expect(result).toContain('class="wikilink link-broken"')
    expect(result).toContain('color: #dc2626')
  })

  it('should add conflict style to conflict wikilinks', () => {
    const html = '<a href="wikilink:Dupe Title" class="wikilink">Dupe Title</a>'
    const statuses: LinkStatusMap = new Map([['wikilink:Dupe Title', 'conflict']])
    const result = resolveWikilinksInHtml(html, '/pk/abc', statuses)
    expect(result).toContain('class="wikilink link-conflict"')
    expect(result).toContain('color: #d97706')
  })

  it('should not add style to ok wikilinks', () => {
    const html = '<a href="wikilink:Good Note" class="wikilink">Good Note</a>'
    const statuses: LinkStatusMap = new Map([['wikilink:Good Note', 'ok']])
    const result = resolveWikilinksInHtml(html, '/pk/abc', statuses)
    expect(result).toContain('class="wikilink"')
    expect(result).not.toContain('link-broken')
    expect(result).not.toContain('link-conflict')
  })
})

describe('renderMarkdown with link statuses', () => {
  it('should annotate broken links in full render pipeline', () => {
    const statuses: LinkStatusMap = new Map([['missing', 'broken']])
    const result = renderMarkdown('[Gone](missing)', testPrefix, undefined, undefined, [], statuses)
    expect(result).toContain('class="link-broken"')
    expect(result).toContain('color: #dc2626')
  })

  it('should annotate broken wikilinks in full render pipeline', () => {
    const statuses: LinkStatusMap = new Map([['wikilink:No Such Note', 'broken']])
    const result = renderMarkdown('[[No Such Note]]', testPrefix, undefined, undefined, [], statuses)
    expect(result).toContain('link-broken')
    expect(result).toContain('color: #dc2626')
  })

  it('should annotate conflict links in full render pipeline', () => {
    const statuses: LinkStatusMap = new Map([['dupe', 'conflict']])
    const result = renderMarkdown('[Dupe](dupe)', testPrefix, undefined, undefined, [], statuses)
    expect(result).toContain('class="link-conflict"')
    expect(result).toContain('color: #d97706')
  })

  it('should not change behavior when linkStatuses is undefined', () => {
    const without = renderMarkdown('[link](my-note)', testPrefix)
    const withUndefined = renderMarkdown('[link](my-note)', testPrefix, undefined, undefined, [], undefined)
    expect(withUndefined).toBe(without)
  })
})
