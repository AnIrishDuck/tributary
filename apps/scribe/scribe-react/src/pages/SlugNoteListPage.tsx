import React from 'react'
import { useNavigate, Link } from 'react-router'
import { PlusIcon, ArrowLeftIcon, DocumentTextIcon, FolderIcon, FolderPlusIcon } from '@heroicons/react/24/outline'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Collection, CollectionSlug, NoteSlugRow } from 'scribe-data'

interface SlugNoteListPageProps {
  collection: CollectionSlug
  ancestors: Collection[]
  childCollections: { collection: Collection; slug: string | null }[]
  notes: NoteSlugRow[]
  slugPath: string
  prefix: string
}

const SlugNoteListPage: React.FC<SlugNoteListPageProps> = ({
  collection, ancestors, childCollections, notes, slugPath, prefix
}) => {
  const navigate = useNavigate()
  const currentSlugPath = slugPath

  const handleBack = () => {
    navigate(`/pk/${prefix}/`)
  }

  const handleNewNote = (collectionUuid?: string) => {
    if (collectionUuid) {
      navigate(`/pk/${prefix}/new?collection=${collectionUuid}`)
    } else {
      navigate(`/pk/${prefix}/new`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={handleBack}
                className="text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors inline-flex items-center font-medium"
              >
                <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
                Back
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => handleNewNote(collection.collection_uuid)}
                className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <PlusIcon className="w-4 h-4 mr-1.5" />
                New Note
              </button>
              <button
                onClick={() => {
                  navigate(`/pk/${prefix}/new-collection?parent=${collection.collection_uuid}`)
                }}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <FolderPlusIcon className="w-4 h-4 mr-1.5" />
                New Collection
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumbs */}
        <Breadcrumbs ancestors={ancestors} prefix={prefix} />

        <h1 className="text-2xl font-bold text-gray-900 mb-6">{collection.title}</h1>

        {/* Child collections */}
        {childCollections.length > 0 && (
          <div className="mb-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {childCollections.map(({ collection: child, slug: childSlug }) => (
                <Link
                  key={child.collection_uuid}
                  to={childSlug ? `/pk/${prefix}/${currentSlugPath}/${childSlug}` : `/pk/${prefix}/`}
                  className="group block"
                >
                  <div className="bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 hover:border-amber-200 transform hover:-translate-y-1">
                    <div className="px-6 py-6">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                          <FolderIcon className="w-6 h-6 text-amber-600" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 truncate group-hover:text-amber-600 transition-colors">
                          {child.title}
                        </h3>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Notes in collection */}
        {notes.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {notes.map((note) => (
              <Link
                key={note.block_uuid}
                to={`/pk/${prefix}/${currentSlugPath}/${note.slug}`}
                className="group block"
              >
                <div className="bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 hover:border-blue-200 transform hover:-translate-y-1">
                  <div className="px-6 py-8">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xl font-bold text-gray-900 truncate group-hover:text-blue-600 transition-colors mb-2">
                          {note.title || 'Untitled'}
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
                        {new Date(note.insert_datetime).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </span>
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                        {note.slug}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ) : childCollections.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
              <DocumentTextIcon className="w-8 h-8 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Empty collection</h3>
            <p className="text-gray-600 mb-6 text-sm">Add notes or subcollections to get started</p>
            <button
              onClick={() => handleNewNote(collection.collection_uuid)}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
            >
              <PlusIcon className="w-4 h-4 mr-1.5" />
              Create first note
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default SlugNoteListPage
