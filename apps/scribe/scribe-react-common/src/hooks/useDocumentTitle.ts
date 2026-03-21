import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { useSyncStatusOptional } from '../context/syncStatusContext'
import { branding } from '../branding'

function slugToTitle(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Derive the current page name from the URL slug path.
 *
 * - Library root (no slug segments)  → library display name from sync status
 * - Sub-collection / note            → title-cased last slug segment
 * - Special routes (+note, +collection, search, &edit) → friendly labels
 */
function getPageName(slugPath: string, libraryName: string): string {
  if (!slugPath) return libraryName

  const segments = slugPath.split('/').filter(Boolean)
  if (segments.length === 0) return libraryName

  const last = segments[segments.length - 1]

  if (last === '+note') return 'New Note'
  if (last === '+collection') return 'New Collection'
  if (last === 'search') return 'Search'
  if (segments.length >= 2 && segments[segments.length - 2] === '+draft') return 'Draft'

  // Strip &edit suffix
  const slug = last.replace(/&edit$/, '')
  return slugToTitle(slug)
}

/**
 * Sets document.title based on the current library and page context.
 *
 * - No library prefix → app name (from branding config)
 * - Library root       → "{library name} | {app name}"
 * - Sub-collection     → "{collection name} | {app name}"
 */
export function useDocumentTitle() {
  const location = useLocation()
  const { client } = useTributary()
  const syncContext = useSyncStatusOptional()
  const syncStatus = syncContext?.syncStatus
  const [homeStreamId, setHomeStreamId] = useState<string | null>(null)

  // Resolve the home stream ID once
  useEffect(() => {
    if (!client) return
    let cancelled = false
    client.getHomeStream().then((id: string | null) => {
      if (!cancelled && id) setHomeStreamId(id)
    })
    return () => { cancelled = true }
  }, [client])

  // Extract prefix and slug path from current URL
  const prefixMatch = location.pathname.match(/^\/pk\/([^/]+)(?:\/(.*))?/)
  const prefix = prefixMatch ? prefixMatch[1] : null
  const slugPath = prefixMatch ? (prefixMatch[2] || '') : ''

  useEffect(() => {
    if (!prefix) {
      // On the homepage, show the home library name if available
      if (homeStreamId && syncStatus?.[homeStreamId]?.libraryTitle) {
        const name = syncStatus[homeStreamId].libraryTitle
        document.title = `${name} | ${branding.appName}`
      } else {
        document.title = branding.appName
      }
      return
    }

    const libStatus = syncStatus?.[prefix]
    const libraryName = libStatus?.libraryTitle || 'Library'

    const pageName = getPageName(slugPath, libraryName)

    document.title = `${pageName} | ${branding.appName}`
  }, [prefix, slugPath, syncStatus, homeStreamId])
}
