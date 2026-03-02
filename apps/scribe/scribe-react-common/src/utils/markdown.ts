import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { isSlugLink, resolveLink } from './links'

/**
 * Resolve slug links in micromark HTML output.
 *
 * Micromark produces deterministic HTML with double-quoted attributes,
 * so we can safely match `<a href="...">` patterns. Slug links (relative
 * URLs with no protocol) are resolved to the full `/#/pk/{prefix}/{slug}`
 * format.
 */
export function resolveSlugLinksInHtml(
  html: string,
  streamPrefix: string,
  currentSlug?: string
): string {
  return html.replace(/<a href="([^"]*)">/g, (match, href) => {
    if (isSlugLink(href)) {
      const resolved = resolveLink(href, streamPrefix, currentSlug)
      return `<a href="${resolved}">`
    }
    return match
  })
}

/**
 * Render markdown to HTML with GFM support and slug link resolution.
 */
export function renderMarkdown(
  content: string,
  streamPrefix: string,
  currentSlug?: string
): string {
  const html = micromark(content, {
    extensions: [gfm()],
    htmlExtensions: [gfmHtml()]
  })
  return resolveSlugLinksInHtml(html, streamPrefix, currentSlug)
}
