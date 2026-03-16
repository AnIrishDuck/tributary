import React, { useEffect, useState } from 'react'
import { useParams, Outlet } from 'react-router'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { useSyncStatus } from 'scribe-react-common/src/context/syncStatusContext'
import { RouteContextProvider } from 'scribe-react-common/src/context/routeContext'
import { titleToSlug } from 'scribe-data'
import { getHomeCollections } from '../actions/getHomeCollections'
import { getLibraries, LibraryInfo } from '../actions/getLibraries'
import LibraryConflictPage from '../pages/LibraryConflictPage'

interface ResolvedLibrary {
  libraryId: string
  libraryTitle: string | null
}

/**
 * Resolves a named library route (#n/:librarySlug/...) to the correct
 * library prefix. When multiple libraries share the same slugified name,
 * renders a conflict disambiguation page instead.
 */
const NamedRouteResolver: React.FC = () => {
  const params = useParams()
  const librarySlug = params.librarySlug || ''
  const { client } = useTributary()
  const { syncStatus, globalSyncStatus } = useSyncStatus()

  const [state, setState] = useState<
    | { type: 'loading' }
    | { type: 'resolved'; prefix: string }
    | { type: 'conflict'; matches: ResolvedLibrary[] }
    | { type: 'not_found' }
  >({ type: 'loading' })

  useEffect(() => {
    const resolve = async () => {
      if (!client || !librarySlug) {
        setState({ type: 'not_found' })
        return
      }

      try {
        // Get all known libraries
        let libraries: LibraryInfo[]
        const collections = await getHomeCollections(client)
        if (collections !== null) {
          libraries = collections
        } else {
          libraries = await getLibraries(client)
        }

        // Merge titles from syncStatus (which has up-to-date library names)
        const enriched = libraries.map(lib => ({
          ...lib,
          libraryTitle: syncStatus[lib.libraryId]?.libraryTitle || lib.libraryTitle,
        }))

        // Also try to fetch display names for libraries without titles
        const withTitles = await Promise.all(
          enriched.map(async lib => {
            if (lib.libraryTitle) return lib
            try {
              const localDb = await client.getLocal('scribe', lib.libraryId)
              if (!localDb) return lib
              const { getLibraryDisplayName } = await import('scribe-data')
              const name = await getLibraryDisplayName(localDb)
              return { ...lib, libraryTitle: name }
            } catch {
              return lib
            }
          })
        )

        // Find libraries whose slugified name matches the URL slug
        const matches = withTitles.filter(lib => {
          if (!lib.libraryTitle) return false
          return titleToSlug(lib.libraryTitle) === librarySlug
        })

        if (matches.length === 1) {
          setState({ type: 'resolved', prefix: matches[0].libraryId })
        } else if (matches.length > 1) {
          setState({
            type: 'conflict',
            matches: matches.map(m => ({
              libraryId: m.libraryId,
              libraryTitle: m.libraryTitle,
            })),
          })
        } else {
          // If sync hasn't completed yet, stay loading
          if (!globalSyncStatus.synced) {
            setState({ type: 'loading' })
          } else {
            setState({ type: 'not_found' })
          }
        }
      } catch (err) {
        console.error('Failed to resolve named route:', err)
        setState({ type: 'not_found' })
      }
    }

    resolve()
  }, [client, librarySlug, syncStatus, globalSyncStatus.synced])

  if (state.type === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-4">
        <div className="text-center">
          <div className="mx-auto w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-2"></div>
          <p className="text-sm text-gray-600">Resolving library...</p>
        </div>
      </div>
    )
  }

  if (state.type === 'not_found') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-4">
        <div className="max-w-md mx-auto px-4 text-center">
          <div className="bg-red-50 border border-red-200 rounded-lg p-6">
            <h2 className="text-lg font-bold text-red-900 mb-2">Library Not Found</h2>
            <p className="text-sm text-red-700">
              No library matching "<span className="font-mono">{librarySlug}</span>" was found.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (state.type === 'conflict') {
    return (
      <LibraryConflictPage
        librarySlug={librarySlug}
        matches={state.matches}
      />
    )
  }

  // Resolved — render child routes wrapped in the named-route context
  return (
    <RouteContextProvider
      paradigm="named"
      prefix={state.prefix}
      namedBase={`/n/${librarySlug}`}
    >
      <Outlet />
    </RouteContextProvider>
  )
}

export default NamedRouteResolver
