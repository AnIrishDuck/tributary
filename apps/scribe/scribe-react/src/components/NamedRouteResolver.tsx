import React, { useEffect, useState } from 'react'
import { useParams, Outlet } from 'react-router'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { useSyncStatus } from 'scribe-react-common/src/context/syncStatusContext'
import { RouteContextProvider } from 'scribe-react-common/src/context/routeContext'
import { PluginProvider } from 'scribe-react-common/src/context/pluginContext'
import { resolveLibrarySlug, LibrarySlugResult } from 'scribe-data'
import LibraryConflictPage from '../pages/LibraryConflictPage'

/**
 * Resolves a named library route (#n/:librarySlug/...) to the correct
 * library prefix. When multiple libraries share the same slugified name,
 * renders a conflict disambiguation page instead.
 */
const NamedRouteResolver: React.FC = () => {
  const params = useParams()
  const librarySlug = params.librarySlug || ''
  const { client } = useTributary()
  const { globalSyncStatus } = useSyncStatus()

  const [state, setState] = useState<
    | { type: 'loading' }
    | { type: 'resolved'; prefix: string }
    | { type: 'conflict'; matches: Array<{ libraryId: string; libraryTitle: string | null }> }
    | { type: 'not_found' }
  >({ type: 'loading' })

  useEffect(() => {
    const resolve = async () => {
      if (!client || !librarySlug) {
        setState({ type: 'not_found' })
        return
      }

      try {
        const result: LibrarySlugResult = await resolveLibrarySlug(client, librarySlug)

        if (result.type === 'resolved') {
          setState({ type: 'resolved', prefix: result.libraryId })
        } else if (result.type === 'conflict') {
          setState({ type: 'conflict', matches: result.matches })
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
  }, [client, librarySlug, globalSyncStatus.synced])

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
      <PluginProvider plugins={[]}>
        <Outlet />
      </PluginProvider>
    </RouteContextProvider>
  )
}

export default NamedRouteResolver
