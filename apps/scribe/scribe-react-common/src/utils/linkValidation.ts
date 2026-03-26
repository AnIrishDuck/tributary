import { TributaryLocal } from 'tributary-client'
import { resolveSlugPath, getLibrary, lookupByTitle } from 'scribe-data'
import { isSlugLink, isAbsoluteInternalLink } from './links'

export type LinkStatus = 'ok' | 'broken' | 'conflict'

/**
 * Map from original link href (or `wikilink:{title}` for wikilinks) to its
 * validation status.
 */
export type LinkStatusMap = Map<string, LinkStatus>

/**
 * Resolve a relative link (starting with `.`) against a collection path.
 * Returns the absolute slug path segments, or null if invalid.
 */
function resolveRelativeLink(href: string, collectionSegments: string[]): string[] | null {
  const parts = href.split('/')
  const result = [...collectionSegments]

  for (const part of parts) {
    if (part === '.' || part === '') {
      continue
    } else if (part === '..') {
      if (result.length === 0) return null
      result.pop()
    } else {
      result.push(part)
    }
  }

  return result.length > 0 ? result : null
}

/**
 * Extract all internal links from raw markdown and validate them against the
 * database. Returns a map keyed by the original href (for slug links) or
 * `wikilink:{title}` (for wikilinks).
 *
 * - **broken**: no matching note/collection exists
 * - **conflict**: multiple entities share the same slug (collision)
 * - **ok**: exactly one match
 *
 * External links, absolute internal links (#pk/...), and tag links (#tag)
 * are skipped.
 */
export async function validateLinks(
  db: TributaryLocal,
  content: string,
  currentSlugPath?: string
): Promise<LinkStatusMap> {
  const statusMap: LinkStatusMap = new Map()

  const library = await getLibrary(db)
  if (!library) return statusMap
  const libraryUuid = library.collection_uuid

  // Collection path = all segments except the last (which is the note itself)
  const currentSegments = currentSlugPath
    ? currentSlugPath.split('/').filter(s => s)
    : []
  const collectionSegments = currentSegments.slice(0, -1)

  // Extract markdown links: [text](href)
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g
  let match

  interface PendingSlugLink {
    href: string
    segments: string[]
  }
  const slugLinks: PendingSlugLink[] = []

  while ((match = linkRegex.exec(content)) !== null) {
    const href = match[2]

    // Skip external, already-resolved, and absolute internal links
    if (!isSlugLink(href)) continue
    if (isAbsoluteInternalLink(href)) continue

    // Skip tag links: [#tag](#tag) — href starts with # and has no /
    if (href.startsWith('#') && !href.includes('/')) continue

    // Already processed this href
    if (statusMap.has(href)) continue

    let segments: string[] | null

    if (href.startsWith('.')) {
      // Relative link — resolve against current collection
      if (currentSegments.length === 0) {
        statusMap.set(href, 'broken')
        continue
      }
      segments = resolveRelativeLink(href, collectionSegments)
      if (!segments) {
        statusMap.set(href, 'broken')
        continue
      }
    } else {
      // Bare slug link — resolves from library root
      segments = href.split('/').filter(s => s)
    }

    if (segments.length === 0) {
      statusMap.set(href, 'broken')
      continue
    }

    slugLinks.push({ href, segments })
  }

  // Extract wikilinks: [[Title]] or [[Title|display]]
  const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g
  const wikilinks: string[] = []

  while ((match = wikilinkRegex.exec(content)) !== null) {
    const title = match[1]
    const key = `wikilink:${title}`
    if (!statusMap.has(key)) {
      wikilinks.push(title)
    }
  }

  // Validate slug links against the database
  for (const { href, segments } of slugLinks) {
    try {
      const result = await resolveSlugPath(db, segments, libraryUuid)
      if (result === null) {
        statusMap.set(href, 'broken')
      } else if (result.type === 'collision') {
        statusMap.set(href, 'conflict')
      } else {
        statusMap.set(href, 'ok')
      }
    } catch {
      statusMap.set(href, 'broken')
    }
  }

  // Validate wikilinks against the title index
  for (const title of wikilinks) {
    const key = `wikilink:${title}`
    try {
      const results = await lookupByTitle(db, title)
      if (results.length === 0) {
        statusMap.set(key, 'broken')
      } else if (results.length > 1) {
        statusMap.set(key, 'conflict')
      } else {
        statusMap.set(key, 'ok')
      }
    } catch {
      statusMap.set(key, 'broken')
    }
  }

  return statusMap
}
