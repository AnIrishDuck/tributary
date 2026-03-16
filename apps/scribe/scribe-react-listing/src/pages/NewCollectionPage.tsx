import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { useSyncStatus } from 'scribe-react-common/src/context/syncStatusContext'
import { useRouteContext } from 'scribe-react-common/src/context/routeContext'
import { createCollection, getLibrary, indexAll, titleToSlug, getSlugPath, Collection } from 'scribe-data'
import { Breadcrumbs } from 'scribe-react-common/src/components/Breadcrumbs'
import { FolderPlusIcon, XMarkIcon } from '@heroicons/react/24/outline'

export interface NewCollectionPageProps {
  prefix: string
  parentUuid?: string
  ancestors?: Collection[]
  cancelPath: string
  libraryName?: string
  /** Optional initial title (used when creating from a missing slug). */
  initialTitle?: string
}

const NewCollectionPage: React.FC<NewCollectionPageProps> = ({ prefix, parentUuid, ancestors = [], cancelPath, libraryName, initialTitle }) => {
  const [title, setTitle] = useState(initialTitle ?? '')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { client } = useTributary()
  const { setFocusedLibrary } = useSyncStatus()
  const routeCtx = useRouteContext()

  // Focus sync on this library while the page is mounted
  useEffect(() => {
    if (prefix) {
      setFocusedLibrary(prefix)
      return () => setFocusedLibrary(null)
    }
  }, [prefix, setFocusedLibrary])

  // No sync gate needed: creating a new collection doesn't require existing
  // content to be loaded. The library is already local (the user navigated
  // from it), and the parent UUID is either the root or provided via props.

  const onCreateCollection = async () => {
    if (!client || !prefix || !title.trim()) return

    setIsLoading(true)
    setError(null)

    try {
      const stream = await client.get('scribe', prefix)
      if (!stream) throw new Error('Failed to get library')

      const localDb = stream.local()

      // Determine parent: use provided parent UUID, or default to library root
      let resolvedParentUuid = parentUuid
      if (!resolvedParentUuid) {
        const library = await getLibrary(localDb)
        if (!library) throw new Error('Library not found')
        resolvedParentUuid = library.collection_uuid
      }

      // Create the collection — the returned entity has a .slug property
      const newCollection = await createCollection(stream, {
        title: title.trim(),
        parent_collection_uuid: resolvedParentUuid,
        inserter: 'web-ui'
      })

      // Sync and re-index
      await stream.sync(1000)
      await indexAll(localDb)

      // Navigate to the new collection via its full slug path
      const slugPathSegments = await getSlugPath(localDb, newCollection.collection_uuid)
      if (slugPathSegments.length > 0) {
        navigate(routeCtx.buildPath(slugPathSegments.join('/')))
      } else {
        navigate(routeCtx.buildPath())
      }
    } catch (err: any) {
      setError('Failed to create collection: ' + (err.message || 'Unknown error'))
      console.error('Error creating collection:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">New Collection</h1>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => navigate(cancelPath)}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <XMarkIcon className="w-4 h-4 mr-1.5" />
                Cancel
              </button>

              <button
                onClick={onCreateCollection}
                disabled={isLoading || !title.trim()}
                className={`inline-flex items-center px-4 py-1.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white ${
                  isLoading || !title.trim()
                    ? 'bg-blue-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200`}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-1.5 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating...
                  </>
                ) : (
                  <>
                    <FolderPlusIcon className="w-4 h-4 mr-1.5" />
                    Create
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <Breadcrumbs
          ancestors={ancestors}
          prefix={prefix}
          allLinks
          trailingSlug={title.trim() ? titleToSlug(title.trim()) : undefined}
        />

        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-lg p-6 md:p-8">
          <label htmlFor="collection-title" className="block text-sm font-medium text-gray-700 mb-2">
            Collection Title
          </label>
          <input
            id="collection-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter collection title..."
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-lg"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) {
                onCreateCollection()
              }
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default NewCollectionPage
