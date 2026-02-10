import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PlusIcon, DocumentTextIcon, ArrowDownIcon } from '@heroicons/react/24/outline'
import { getStreams } from '../actions/getStreams'
import { useTributary } from '../context/tributaryContext'

const HomePage: React.FC = () => {
  const { client } = useTributary()
  const [streams, setStreams] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchStreams = async () => {
      if (client) {
        try {
          const streamIds = await getStreams(client)
          setStreams(streamIds)
        } catch (error) {
          console.error('Failed to fetch streams:', error)
        } finally {
          setLoading(false)
        }
      } else {
        setLoading(false)
      }
    }

    fetchStreams()
  }, [client])

  return (
    <div className="min-h-screen bg-gray-50 py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {loading ? (
          <div className="text-center py-8">
            <p className="text-gray-500">Loading your streams...</p>
          </div>
        ) : streams.length > 0 ? (
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-8 py-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Your Streams</h3>
                <p className="mt-2 text-gray-600">
                  You have {streams.length} {streams.length === 1 ? 'stream' : 'streams'} available.
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
                {streams.map((streamId) => {
                  // Stream ID is base64url encoded public key
                  // Show pk/ prefix followed by the full encoded key
                  const displayId = `pk/${streamId}`
                  return (
                    <Link
                      key={streamId}
                      to={`/pk/${streamId}/`}
                      className="flex items-center p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all duration-200 group"
                    >
                      <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-lg bg-purple-100 text-purple-600 group-hover:bg-purple-200">
                        <DocumentTextIcon className="h-5 w-5" />
                      </div>
                      <div className="ml-4 flex-1">
                        <h4 className="text-base font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                          {displayId}
                        </h4>
                        <p className="text-sm text-gray-500">Last edited: Just now</p>
                      </div>
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
