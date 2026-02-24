import React from 'react'
import { useNavigate, Link } from 'react-router'
import { ArrowLeftIcon, DocumentTextIcon, FolderIcon } from '@heroicons/react/24/outline'
import { CollectionSlug } from 'scribe-data'

interface BlockSlugInfo {
  block_uuid: string;
  slug: string;
  title: string;
  indexed_at: string;
}

interface SlugCollisionProps {
  notes: BlockSlugInfo[]
  collections: CollectionSlug[]
  slugPath: string
  splatPath: string
  prefix: string
}

const SlugCollision: React.FC<SlugCollisionProps> = ({ notes, collections, slugPath, splatPath, prefix }) => {
  const navigate = useNavigate()

  const handleBack = () => {
    navigate(`/pk/${prefix}/`)
  }

  const hasCollisions = collections.length > 0

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors inline-flex items-center font-medium"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
              Back
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-xl shadow overflow-hidden p-6 md:p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            {hasCollisions
              ? `Multiple items match "${splatPath}"`
              : `Multiple notes match "${splatPath}"`}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {hasCollisions
              ? 'Select the item you want to view:'
              : 'Select the note you want to view:'}
          </p>

          {hasCollisions && collections.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Collections</h3>
              <div className="space-y-3">
                {collections.map((col) => (
                  <Link
                    key={col.collection_uuid}
                    to={`/pk/${prefix}/${slugPath}`}
                    className="block bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-lg p-4 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <FolderIcon className="w-5 h-5 text-amber-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{col.title}</p>
                        <p className="text-xs text-gray-500">Collection</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {notes.length > 0 && (
            <div>
              {hasCollisions && (
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Notes</h3>
              )}
              <div className="space-y-3">
                {notes.map((note) => (
                  <Link
                    key={note.block_uuid}
                    to={`/pk/${prefix}/${slugPath}/${note.block_uuid}`}
                    className="block bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-lg p-4 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <DocumentTextIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{note.title || 'Untitled'}</p>
                        <p className="text-xs text-gray-500 font-mono truncate">{note.block_uuid}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SlugCollision
