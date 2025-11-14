import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { getAllBlocksWithTitles, BlockSlugRow } from 'scribe-data'
import { TributaryLocal } from 'tributary-client'

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
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="text-center">Loading blocks...</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            <strong>Error:</strong> {error}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Documents</h1>
          <button
            onClick={handleNewBlock}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            + New Document
          </button>
        </div>

        {blocks.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <p className="text-gray-700 mb-4">No documents found.</p>
            <button
              onClick={handleNewBlock}
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
            >
              Create your first document
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <ul className="divide-y divide-gray-200">
              {blocks.map((block) => (
                <li key={block.block_uuid} className="hover:bg-gray-50">
                  <a 
                    href={`#/pk/${prefix}/${block.slug}`}
                    className="block px-6 py-4"
                  >
                    <div className="flex items-center">
                      <div className="flex-1 min-w-0">
                        <h2 className="text-lg font-medium text-gray-900 truncate">
                          {block.title || 'Untitled'}
                        </h2>
                        <p className="text-sm text-gray-500 truncate">
                          Last updated: {new Date(block.indexed_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="ml-4 flex-shrink-0">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {block.slug}
                        </span>
                      </div>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export default BlockListPage
