import React, { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { getAllBlocksWithTitles, BlockSlugRow } from 'scribe-data'
import { TributaryLocal } from 'tributary-client'
import { PlusIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

const BlockListPage: React.FC = () => {
  const { prefix } = useParams<{ prefix: string }>()
  const navigate = useNavigate()
  const { client } = useTributary()
  const [blocks, setBlocks] = useState<BlockSlugRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadBlocks = async () => {
      if (!client || !prefix) {
        setError('Client or prefix not available')
        setLoading(false)
        return
      }

      try {
        // Get the local database for this stream
        const localDb = await client.getLocal('scribe', prefix)
        if (!localDb) {
          throw new Error('Could not get local database')
        }

        // Get all blocks with titles
        const blockList = await getAllBlocksWithTitles(localDb)
        setBlocks(blockList)
        setError(null)
      } catch (err) {
        console.error('Error loading blocks:', err)
        setError(`Failed to load blocks: ${(err as Error).message}`)
      } finally {
        setLoading(false)
      }
    }

    loadBlocks()
  }, [client, prefix])

  const handleNewBlock = () => {
    if (prefix) {
      navigate(`/pk/${prefix}/new`)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600">Loading documents...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12">
        <div className="max-w-md mx-auto px-4">
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
            <svg className="mx-auto w-12 h-12 text-red-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-red-800 font-medium mb-2">Error</p>
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Documents</h1>
              <p className="text-lg text-gray-600">
                {blocks.length} document{blocks.length !== 1 ? 's' : ''} in this stream
              </p>
            </div>
            
            <button
              onClick={handleNewBlock}
              className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200 transform hover:-translate-y-0.5"
            >
              <PlusIcon className="w-5 h-5 mr-2" />
              New Document
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {blocks.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
            <div className="mx-auto w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6">
              <DocumentTextIcon className="w-10 h-10 text-blue-600" />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">No documents found</h3>
            <p className="text-gray-600 mb-8">Create your first encrypted document to get started</p>
            <button
              onClick={handleNewBlock}
              className="inline-flex items-center px-8 py-3 border border-transparent text-base font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200 transform hover:-translate-y-0.5"
            >
              <PlusIcon className="w-5 h-5 mr-2" />
              Create your first document
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {blocks.map((block) => (
              <Link
                key={block.block_uuid}
                to={`/pk/${prefix}/${block.slug}`}
                className="group block"
              >
                <div className="bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 hover:border-blue-200 transform hover:-translate-y-1">
                  <div className="px-6 py-8">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xl font-bold text-gray-900 truncate group-hover:text-blue-600 transition-colors mb-2">
                          {block.title || 'Untitled'}
                        </h3>
                      </div>
                      <div className="flex-shrink-0">
                        <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                          <DocumentTextIcon className="w-6 h-6 text-blue-600" />
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                      <span className="text-sm text-gray-500">
                        {new Date(block.indexed_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </span>
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        {block.slug}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {blocks.length > 0 && (
          <div className="mt-12 text-center">
            <button
              onClick={handleNewBlock}
              className="inline-flex items-center px-8 py-4 border border-transparent text-lg font-medium rounded-xl shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200 transform hover:-translate-y-0.5"
            >
              <PlusIcon className="w-5 h-5 mr-2" />
              Create New Document
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default BlockListPage
