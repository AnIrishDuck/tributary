import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { useSyncStatusOptional } from '../context/syncStatusContext'

/**
 * Sets document.title based on the current library context.
 *
 * - No library prefix → "Scribe"
 * - Home library     → "{name} | Scribe (home library)"
 * - Linked library   → "{name} | Scribe (linked library)"
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

  // Extract prefix from current path
  const prefixMatch = location.pathname.match(/^\/pk\/([^/]+)/)
  const prefix = prefixMatch ? prefixMatch[1] : null

  useEffect(() => {
    if (!prefix) {
      document.title = 'Scribe'
      return
    }

    const libStatus = syncStatus?.[prefix]
    const libraryName = libStatus?.libraryTitle || 'Library'

    const libraryType = homeStreamId && prefix === homeStreamId
      ? 'home library'
      : 'linked library'

    document.title = `${libraryName} | Scribe (${libraryType})`
  }, [prefix, syncStatus, homeStreamId])
}
