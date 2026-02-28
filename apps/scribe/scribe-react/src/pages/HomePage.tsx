import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PlusIcon, DocumentTextIcon, ArrowDownIcon, ShareIcon } from '@heroicons/react/24/outline'
import { getLibraries, LibraryInfo } from '../actions/getLibraries'
import { getHomeCollections } from '../actions/getHomeCollections'
import { useTributary } from '../context/tributaryContext'
import { useSyncStatus } from '../context/syncStatusContext'

const HomePage: React.FC = () => {
  const { client } = useTributary()
  const { syncStatus, globalSyncStatus, setFocusedLibrary } = useSyncStatus()
  const [libraries, setLibraries] = useState<LibraryInfo[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [copiedLibraryId, setCopiedLibraryId] = useState<string | null>(null)

  // Clear focused library so all libraries sync on the home page
  useEffect(() => {
    setFocusedLibrary(null)
  }, [setFocusedLibrary])

  useEffect(() => {
    const fetchData = async () => {
      if (client) {
        try {
          const collections = await getHomeCollections(client)
          if (collections !== null) {
            setLibraries(collections)
          } else {
            const libraryList = await getLibraries(client)
            setLibraries(libraryList)
          }
        } catch (error) {
          console.error('Failed to fetch home data:', error)
        } finally {
          setLoading(false)
        }
      } else {
        setLoading(false)
      }
    }

    fetchData()
  }, [client, syncStatus])

  const handleShare = async (e: React.MouseEvent, streamId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!client) return

    try {
      const writeKey = await client.getWriteKey(streamId)
      if (!writeKey) {
        console.error('No write key found for library')
        return
      }
      const url = `${window.location.origin}${window.location.pathname}#/import/write/${writeKey}`
      await navigator.clipboard.writeText(url)
      setCopiedLibraryId(streamId)
      setTimeout(() => setCopiedLibraryId(null), 2000)
    } catch (err) {
      console.error('Failed to copy share link:', err)
    }
  }

  const hasItems = libraries !== null && libraries.length > 0
  const itemCount = libraries?.length ?? 0
  const itemLabel = itemCount === 1 ? 'library' : 'libraries'

  return (
    <div className="min-h-screen bg-gray-50 py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {loading ? (
          <div className="text-center py-8">
            <p className="text-gray-500">Loading your libraries...</p>
          </div>
        ) : hasItems ? (
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-8 py-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Your Libraries</h3>
                <p className="mt-2 text-gray-600">
                  You have {itemCount} {itemLabel} available.
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  to="/new"
                  className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors"
                  aria-label="Create new library"
                >
                  <PlusIcon className="h-6 w-6" />
                </Link>
                <Link
                  to="/import"
                  className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 transition-colors"
                  aria-label="Import existing library"
                >
                  <ArrowDownIcon className="h-6 w-6" />
                </Link>
              </div>
            </div>
            <div className="px-8 py-6 bg-gray-50">
              <div className="space-y-3">
                {libraries!.map((library) => {
                    // Merge per-library metadata from the sync loop
                    const libStatus = syncStatus[library.libraryId]
                    const displayName = libStatus?.libraryTitle || library.libraryTitle || 'Notes'
                    const displayId = `pk/${library.libraryId.substring(0, 16)}...`
                    const isSyncing = libStatus != null && !libStatus.synced
                    const hasSynced = libStatus?.lastSyncedAt != null

                    const lastEdited = libStatus?.lastEdited ?? library.lastEdited
                    const lastEditedText = isSyncing
                      ? null // progress indicator replaces this
                      : !hasSynced
                        ? 'Awaiting sync'
                        : lastEdited
                          ? new Date(lastEdited).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })
                          : 'No edits yet'

                    return (
                      <Link
                        key={library.libraryId}
                        to={`/pk/${library.libraryId}/`}
                        className="flex items-center p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all duration-200 group"
                      >
                        <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-lg bg-purple-100 text-purple-600 group-hover:bg-purple-200">
                          <DocumentTextIcon className="h-5 w-5" />
                        </div>
                        <div className="ml-4 flex-1">
                          <h4 className="text-base font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                            {displayName}
                          </h4>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-mono">{displayId}</span>
                            <span className="text-gray-300">·</span>
                            {isSyncing ? (
                              <span className="text-xs text-blue-600 font-medium">
                                Syncing {libStatus.currentIndex}/{libStatus.finalIndex}
                              </span>
                            ) : (
                              <p className="text-sm text-gray-500">{lastEditedText}</p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleShare(e, library.libraryId)}
                          className="flex-shrink-0 mr-2 inline-flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          aria-label="Share library"
                          title="Copy share link"
                        >
                          {copiedLibraryId === library.libraryId ? (
                            <span className="text-xs font-medium text-green-600">Copied!</span>
                          ) : (
                            <ShareIcon className="h-4 w-4" />
                          )}
                        </button>
                        <div className="flex-shrink-0">
                          <svg className="h-5 w-5 text-gray-400 group-hover:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </Link>
                    )
                  })}
              </div>
            </div>
          </div>
        ) : globalSyncStatus.isSyncing ? (
          // Sync still in progress — don't show "No libraries" until we know for sure
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-8 py-16 text-center">
              <h3 className="text-2xl font-semibold text-gray-900">Syncing your libraries</h3>
              <p className="mt-2 text-gray-600">
                Downloading and indexing your encrypted data...
              </p>
              {globalSyncStatus.finalIndex > 0 && (
                <p className="mt-4 text-sm text-blue-600 font-medium">
                  {globalSyncStatus.currentIndex} / {globalSyncStatus.finalIndex}
                </p>
              )}
              <div className="mt-6 inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          </div>
        ) : (
          // Sync complete and genuinely no libraries — show empty state
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-8 py-16 text-center">
              <h3 className="text-2xl font-semibold text-gray-900">No libraries yet</h3>
              <p className="mt-2 text-gray-600">
                Create a new encrypted library or import an existing one to begin managing your secure notes.
              </p>
              <div className="mt-8 flex justify-center gap-4">
                <Link
                  to="/new"
                  className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                >
                  <PlusIcon className="h-5 w-5 mr-2" />
                  Create New Library
                </Link>
                <Link
                  to="/import"
                  className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-green-700 bg-green-100 hover:bg-green-200 transition-colors"
                >
                  <ArrowDownIcon className="h-5 w-5 mr-2" />
                  Import Existing Library
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default HomePage
