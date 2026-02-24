import React from 'react'
import { useNavigate, Link } from 'react-router'
import { PlusIcon, ArrowLeftIcon, DocumentTextIcon, FolderIcon, FolderPlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Collection, CollectionSlug, NoteSlugRow } from 'scribe-data'

interface NoteListViewProps {
  collections: { collection: Collection; slug: string | null }[]
  notes: NoteSlugRow[]
  prefix: string
  slugPath: string

  // Root view props
  libraryName?: string | null
  syncProgress?: { currentIndex: number; finalIndex: number; synced: boolean } | null

  // Collection view props
  collection?: CollectionSlug
  ancestors?: Collection[]
}

const NoteListView: React.FC<NoteListViewProps> = ({
  collections, notes, prefix, slugPath,
  libraryName, syncProgress,
  collection, ancestors
}) => {
  const navigate = useNavigate()
  const isRoot = !collection

  const showSyncProgress = syncProgress && !syncProgress.synced

  const collectionUuid = collection?.collection_uuid

  const handleNewNote = () => {
    if (collectionUuid) {
      navigate(`/pk/${prefix}/new?collection=${collectionUuid}`)
    } else {
      navigate(`/pk/${prefix}/new`)
    }
  }

  const handleNewCollection = () => {
    if (collectionUuid) {
      navigate(`/pk/${prefix}/new-collection?parent=${collectionUuid}`)
    } else {
      navigate(`/pk/${prefix}/new-collection`)
    }
  }

  const handleBack = () => {
    if (isRoot) {
      navigate('/')
    } else {
      navigate(`/pk/${prefix}/`)
    }
  }

  const linkPrefix = slugPath ? `/pk/${prefix}/${slugPath}` : `/pk/${prefix}`

  const totalItems = notes.length + collections.length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sync Progress Banner */}
      {showSyncProgress && (
        <div className="bg-blue-50 border-b border-blue-200 py-2">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-center gap-2 text-sm">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-blue-900 font-medium">
                Syncing: {syncProgress.currentIndex}/{syncProgress.finalIndex} blocks
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={handleBack}
                className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ArrowLeftIcon className="w-4 h-4 mr-1" />
                {isRoot ? 'Libraries' : 'Back'}
              </button>
              {isRoot && (
                <>
                  <h1 className="text-xl font-bold text-gray-900">{libraryName || 'Notes'}</h1>
                  <span className="text-sm text-gray-500 px-2 py-1 bg-gray-100 rounded-full">
                    {notes.length} note{notes.length !== 1 ? 's' : ''}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isRoot && (
                <button
                  onClick={() => navigate(`/pk/${prefix}/search`)}
                  className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
                >
                  <MagnifyingGlassIcon className="w-4 h-4 mr-1.5" />
                  Search
                </button>
              )}

              <button
                onClick={handleNewCollection}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <FolderPlusIcon className="w-4 h-4 mr-1.5" />
                New Collection
              </button>

              <button
                onClick={handleNewNote}
                className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <PlusIcon className="w-4 h-4 mr-1.5" />
                {isRoot ? 'New' : 'New Note'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumbs (collection view only) */}
        {!isRoot && ancestors && (
          <Breadcrumbs ancestors={ancestors} prefix={prefix} />
        )}

        {/* Collection title (collection view only) */}
        {!isRoot && (
          <h1 className="text-2xl font-bold text-gray-900 mb-6">{collection.title}</h1>
        )}

        {totalItems === 0 ? (
          isRoot && showSyncProgress ? (
            <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
              <div className="mx-auto w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4"></div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Syncing {syncProgress.currentIndex}/{syncProgress.finalIndex} blocks
              </h3>
              <p className="text-gray-600 text-sm">Notes will appear as they are synced</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
              <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                <DocumentTextIcon className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                {isRoot ? 'No notes found' : 'Empty collection'}
              </h3>
              <p className="text-gray-600 mb-6 text-sm">
                {isRoot ? 'Create your first encrypted note to get started' : 'Add notes or subcollections to get started'}
              </p>
              <button
                onClick={handleNewNote}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <PlusIcon className="w-4 h-4 mr-1.5" />
                Create first note
              </button>
            </div>
          )
        ) : (
          <>
            {/* Collections */}
            {collections.length > 0 && (
              <div className="mb-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {collections.map(({ collection: col, slug: collectionSlug }) => (
                    <Link
                      key={col.collection_uuid}
                      to={collectionSlug ? `${linkPrefix}/${collectionSlug}` : `/pk/${prefix}/`}
                      className="group block"
                    >
                      <div className="bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-gray-100 hover:border-amber-200 transform hover:-translate-y-1">
                        <div className="px-6 py-6">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                              <FolderIcon className="w-6 h-6 text-amber-600" />
                            </div>
                            <h3 className="text-lg font-bold text-gray-900 truncate group-hover:text-amber-600 transition-colors">
                              {col.title}
                            </h3>
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {notes.map((note) => (
                <Link
                  key={note.block_uuid}
                  to={`${linkPrefix}/${note.slug}`}
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
          </>
        )}

        {notes.length > 0 && isRoot && (
          <div className="mt-8 text-center">
            <button
              onClick={handleNewNote}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
            >
              <PlusIcon className="w-4 h-4 mr-1.5" />
              Create New Note
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default NoteListView
