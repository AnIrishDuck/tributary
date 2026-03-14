import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { isSlugLink, isAbsoluteInternalLink, resolveLink } from './links'

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
 * Render markdown to HTML with GFM support and slug link resolution.
 *
 * @param routeBase - Optional route base for link resolution (e.g. "/n/my-library").
 *   When omitted, defaults to "/pk/{streamPrefix}".
 */
export function renderMarkdown(
  content: string,
  streamPrefix: string,
  currentSlug?: string,
  routeBase?: string
): string {
  const html = micromark(content, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()]
  })
  return resolveSlugLinksInHtml(html, streamPrefix, currentSlug, routeBase)
}
