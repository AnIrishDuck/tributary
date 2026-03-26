import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { isSlugLink, isAbsoluteInternalLink, resolveLink } from './links'
import { wikilinkSyntax, wikilinkHtml } from '../wikilink/syntax'
import type { ScribePlugin } from '../plugins/types'

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
export function resolveSlugLinksInHtml(
  html: string,
  streamPrefix: string,
  currentSlug?: string,
  routeBase?: string
): string {
  return html.replace(/<a href="([^"]*)">/g, (match, href) => {
    if (isAbsoluteInternalLink(href)) {
      const resolved = resolveLink(href, streamPrefix, currentSlug, routeBase)
      return `<a href="${resolved}">`
    }
    if (isSlugLink(href)) {
      const resolved = resolveLink(href, streamPrefix, currentSlug, routeBase)
      return `<a href="${resolved}">`
    }
    return match
  })
}

/**
 * Resolve wikilink placeholder URLs in HTML output.
 *
 * Rewrites `<a href="wikilink:Title">` tags to `&titled?t=` route URLs.
 */
export function resolveWikilinksInHtml(
  html: string,
  routeBase: string
): string {
  return html.replace(
    /<a href="wikilink:([^"]*)" class="wikilink">/g,
    (_match, rawTitle: string) => {
      const title = rawTitle.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      return `<a href="/#${routeBase}/&titled?t=${encodeURIComponent(title)}" class="wikilink">`
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
  plugins?: ScribePlugin[]
): string {
  const pluginExtensions = (plugins ?? []).flatMap(p => p.micromark?.extensions ?? [])
  const pluginHtmlExtensions = (plugins ?? []).flatMap(p => p.micromark?.htmlExtensions ?? [])

  let html = micromark(content, {
    extensions: [gfm(), wikilinkSyntax(), ...pluginExtensions],
    htmlExtensions: [gfmHtml(), wikilinkHtml(), ...pluginHtmlExtensions]
  })

  html = resolveSlugLinksInHtml(html, streamPrefix, currentSlug, routeBase)
  html = resolveWikilinksInHtml(html, routeBase || `/pk/${streamPrefix}`)

  for (const plugin of plugins ?? []) {
    if (plugin.transformHtml) {
      html = plugin.transformHtml(html)
    }
  }

  return html
}
