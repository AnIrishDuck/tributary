export interface InvalidLink {
  type: 'InvalidLink'
}

export interface AbsoluteLink {
  type: 'AbsoluteLink'
  path: string
}

export type ResolvedLink = InvalidLink | AbsoluteLink

/**
 * Resolve a link relative to a collection path.
 *
 * Links starting with `/` are absolute and resolve from the library root.
 * Links starting with `./` or `../` are relative to the given collection.
 * Bare links (no prefix) are treated as relative to the current collection (`./`).
 *
 * Returns InvalidLink if the link navigates above the library root.
 */
export function resolveLink(collection: string, link: string): ResolvedLink {
  if (link === '') {
    return { type: 'InvalidLink' }
  }

  // Absolute links resolve from root
  if (link.startsWith('/')) {
    const segments = link.split('/').filter(s => s.length > 0)
    return { type: 'AbsoluteLink', path: '/' + segments.join('/') }
  }

  // Relative links resolve against the collection
  const baseSegments = collection.split('/').filter(s => s.length > 0)

  // Bare links are treated as ./link
  const normalizedLink = (link.startsWith('./') || link.startsWith('../'))
    ? link
    : './' + link

  const linkSegments = normalizedLink.split('/')

  const result = [...baseSegments]

  for (const segment of linkSegments) {
    if (segment === '.' || segment === '') {
      continue
    } else if (segment === '..') {
      if (result.length === 0) {
        return { type: 'InvalidLink' }
      }
      result.pop()
    } else {
      result.push(segment)
    }
  }

  return { type: 'AbsoluteLink', path: '/' + result.join('/') }
}
