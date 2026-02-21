import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PlusIcon, DocumentTextIcon, ArrowDownIcon, ShareIcon } from '@heroicons/react/24/outline'
import { getStreams, StreamInfo } from '../actions/getStreams'
import { getHomeCollections, HomeCollection } from '../actions/getHomeCollections'
import { useTributary } from '../context/tributaryContext'
import { useSyncStatus } from '../context/syncStatusContext'

type DataSource =
  | { kind: 'collections'; collections: HomeCollection[] }
  | { kind: 'streams'; streams: StreamInfo[] }

const HomePage: React.FC = () => {
  const { client } = useTributary()
  const { syncStatus, setFocusedStream } = useSyncStatus()
  const [data, setData] = useState<DataSource | null>(null)
  const [loading, setLoading] = useState(true)
  const [copiedStreamId, setCopiedStreamId] = useState<string | null>(null)

  // Clear focused stream so all streams sync on the home page
  useEffect(() => {
    setFocusedStream(null)
  }, [setFocusedStream])

  useEffect(() => {
    const fetchData = async () => {
      if (client) {
        try {
          // Try home collections first
          const collections = await getHomeCollections(client)
          if (collections) {
            setData({ kind: 'collections', collections })
          } else {
            // Fall back to raw stream list
            const streams = await getStreams(client)
            setData({ kind: 'streams', streams })
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
        console.error('No write key found for stream')
        return
      }
      const url = `${window.location.origin}${window.location.pathname}#/import/write/${writeKey}`
      await navigator.clipboard.writeText(url)
      setCopiedStreamId(streamId)
      setTimeout(() => setCopiedStreamId(null), 2000)
    } catch (err) {
      console.error('Failed to copy share link:', err)
    }
  }

  const hasItems = data !== null && (
    (data.kind === 'collections' && data.collections.length > 0) ||
    (data.kind === 'streams' && data.streams.length > 0)
  )

  const itemCount = data === null ? 0
    : data.kind === 'collections' ? data.collections.length
    : data.streams.length

  const headerLabel = data?.kind === 'collections' ? 'Your Collections' : 'Your Streams'
  const itemLabel = data?.kind === 'collections'
    ? (itemCount === 1 ? 'collection' : 'collections')
    : (itemCount === 1 ? 'stream' : 'streams')

  return (
    <div className="min-h-screen bg-gray-50 py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {loading ? (
          <div className="text-center py-8">
            <p className="text-gray-500">Loading...</p>
          </div>
        ) : hasItems ? (
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-8 py-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">{headerLabel}</h3>
                <p className="mt-2 text-gray-600">
                  You have {itemCount} {itemLabel} available.
                </p>
              </div>
              <div className="flex gap-3">
                <Link
                  to="/new"
                  className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors"
                  aria-label="Create new stream"
                >
                  <PlusIcon className="h-6 w-6" />
                </Link>
                <Link
                  to="/import"
                  className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 transition-colors"
                  aria-label="Import existing stream"
                >
                  <ArrowDownIcon className="h-6 w-6" />
                </Link>
              </div>
            </div>
            <div className="px-8 py-6 bg-gray-50">
              <div className="space-y-3">
                {data!.kind === 'collections' ? (
                  data!.collections.map((collection) => {
                    const displayId = `pk/${collection.linkedStreamId.substring(0, 16)}...`
                    const lastEditedText = collection.lastEdited
                      ? new Date(collection.lastEdited).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })
                      : 'No edits yet'

                    const streamSyncStatus = syncStatus[collection.linkedStreamId]
                    const showProgress = streamSyncStatus && !streamSyncStatus.synced

                    return (
                      <Link
                        key={collection.linkedStreamId}
                        to={`/pk/${collection.linkedStreamId}/`}
                        className="flex items-center p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all duration-200 group"
                      >
                        <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-lg bg-purple-100 text-purple-600 group-hover:bg-purple-200">
                          <DocumentTextIcon className="h-5 w-5" />
                        </div>
                        <div className="ml-4 flex-1">
                          <h4 className="text-base font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                            {collection.title}
                          </h4>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-mono">{displayId}</span>
                            <span className="text-gray-300">·</span>
                            <p className="text-sm text-gray-500">{lastEditedText}</p>
                            {showProgress && (
                              <span className="text-xs text-blue-600 font-medium">
                                Syncing {streamSyncStatus.currentIndex}/{streamSyncStatus.finalIndex}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleShare(e, collection.linkedStreamId)}
                          className="flex-shrink-0 mr-2 inline-flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          aria-label="Share stream"
                          title="Copy share link"
                        >
                          {copiedStreamId === collection.linkedStreamId ? (
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
                  })
                ) : (
                  (data as { kind: 'streams'; streams: StreamInfo[] }).streams.map((stream) => {
                    const displayName = stream.rootCollectionTitle || 'Notes'
                    const displayId = `pk/${stream.streamId.substring(0, 16)}...`
                    const lastEditedText = stream.lastEdited
                      ? new Date(stream.lastEdited).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })
                      : 'No edits yet'

                    const streamSyncStatus = syncStatus[stream.streamId]
                    const showProgress = streamSyncStatus && !streamSyncStatus.synced

                    return (
                      <Link
                        key={stream.streamId}
                        to={`/pk/${stream.streamId}/`}
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
                            <p className="text-sm text-gray-500">{lastEditedText}</p>
                            {showProgress && (
                              <span className="text-xs text-blue-600 font-medium">
                                Syncing {streamSyncStatus.currentIndex}/{streamSyncStatus.finalIndex}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleShare(e, stream.streamId)}
                          className="flex-shrink-0 mr-2 inline-flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          aria-label="Share stream"
                          title="Copy share link"
                        >
                          {copiedStreamId === stream.streamId ? (
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
                  })
                )}
              </div>
            </div>
          </div>
        ) : (
          // No streams - show empty state
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-8 py-16 text-center">
              <h3 className="text-2xl font-semibold text-gray-900">No streams yet</h3>
              <p className="mt-2 text-gray-600">
                Create a new encrypted document stream or import an existing one to begin managing your secure documents.
              </p>
              <div className="mt-8 flex justify-center gap-4">
                <Link
                  to="/new"
                  className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                >
                  <PlusIcon className="h-5 w-5 mr-2" />
                  Create New Stream
                </Link>
                <Link
                  to="/import"
                  className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-green-700 bg-green-100 hover:bg-green-200 transition-colors"
                >
                  <ArrowDownIcon className="h-5 w-5 mr-2" />
                  Import Existing Stream
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
