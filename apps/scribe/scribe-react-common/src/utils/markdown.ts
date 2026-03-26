import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { isSlugLink, isAbsoluteInternalLink, resolveLink } from './links'
import { wikilinkSyntax, wikilinkHtml } from '../wikilink/syntax'
import type { ScribePlugin } from '../plugins/types'
import type { LinkStatusMap } from './linkValidation'

/**
 * Resolve slug links in micromark HTML output.
 *
 * Micromark produces deterministic HTML with double-quoted attributes,
 * so we can safely match `<a href="...">` patterns. Slug links (relative
 * URLs with no protocol) are resolved to the full route URL using the
 * current routing paradigm.
 *
 * Links that start with `#` and contain `/` are treated as absolute
 * internal links and resolved to `/#/{path}` regardless of paradigm.
 */
/** Inline style for broken links (red). */
const BROKEN_STYLE = 'color: #dc2626; text-decoration-color: #dc2626;'
/** Inline style for conflict/collision links (yellow/amber). */
const CONFLICT_STYLE = 'color: #d97706; text-decoration-color: #d97706;'

function linkStatusAttrs(href: string, linkStatuses?: LinkStatusMap): string {
  if (!linkStatuses) return ''
  const status = linkStatuses.get(href)
  if (status === 'broken') return ` class="link-broken" style="${BROKEN_STYLE}"`
  if (status === 'conflict') return ` class="link-conflict" style="${CONFLICT_STYLE}"`
  return ''
}

export function resolveSlugLinksInHtml(
  html: string,
  streamPrefix: string,
  currentSlug?: string,
  routeBase?: string,
  linkStatuses?: LinkStatusMap
): string {
  return html.replace(/<a href="([^"]*)">/g, (match, href) => {
    if (isAbsoluteInternalLink(href)) {
      const resolved = resolveLink(href, streamPrefix, currentSlug, routeBase)
      return `<a href="${resolved}">`
    }
    if (isSlugLink(href)) {
      const resolved = resolveLink(href, streamPrefix, currentSlug, routeBase)
      const attrs = linkStatusAttrs(href, linkStatuses)
      return `<a href="${resolved}"${attrs}>`
    }
    return match
  })
}

/**
 * Resolve wikilink placeholder URLs in HTML output.
 *
 * Rewrites `<a href="wikilink:Title">` tags to `&titled?t=` route URLs.
 * Uses `&` prefix to avoid collisions with user-defined slugs.
 */
export function resolveWikilinksInHtml(
  html: string,
  routeBase: string,
  linkStatuses?: LinkStatusMap
): string {
  return html.replace(
    /<a href="wikilink:([^"]*)" class="wikilink">/g,
    (_match, rawTitle: string) => {
      const title = rawTitle.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      const resolved = `/#${routeBase}/&titled?t=${encodeURIComponent(title)}`
      const key = `wikilink:${title}`
      const status = linkStatuses?.get(key)
      let cls = 'wikilink'
      let style = ''
      if (status === 'broken') {
        cls += ' link-broken'
        style = ` style="${BROKEN_STYLE}"`
      } else if (status === 'conflict') {
        cls += ' link-conflict'
        style = ` style="${CONFLICT_STYLE}"`
      }
      return `<a href="${resolved}" class="${cls}"${style}>`
    }
  )
}

/**
 * Render markdown to HTML with GFM support and slug link resolution.
 *
 * @param routeBase - Optional route base for link resolution (e.g. "/n/my-library").
 *   When omitted, defaults to "/pk/{streamPrefix}".
 */
export function renderMarkdown(
  content: string,
  streamPrefix: string,
  currentSlug?: string,
  routeBase?: string,
  plugins?: ScribePlugin[],
  linkStatuses?: LinkStatusMap
): string {
  const pluginExtensions = (plugins ?? []).flatMap(p => p.micromark?.extensions ?? [])
  const pluginHtmlExtensions = (plugins ?? []).flatMap(p => p.micromark?.htmlExtensions ?? [])

  let html = micromark(content, {
    extensions: [gfm(), wikilinkSyntax(), ...pluginExtensions],
    htmlExtensions: [gfmHtml(), wikilinkHtml(), ...pluginHtmlExtensions]
  })

  html = resolveSlugLinksInHtml(html, streamPrefix, currentSlug, routeBase, linkStatuses)
  html = resolveWikilinksInHtml(html, routeBase || `/pk/${streamPrefix}`, linkStatuses)

  for (const plugin of plugins ?? []) {
    if (plugin.transformHtml) {
      html = plugin.transformHtml(html)
    }
  }

  return html
}
