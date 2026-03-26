import React, { useMemo, useEffect } from 'react'
import { useNavigate, Link } from 'react-router'
import { PlusIcon, PhotoIcon, ArrowLeftIcon, DocumentTextIcon, FolderIcon, FolderPlusIcon, MagnifyingGlassIcon, PencilSquareIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { SlugActionBar } from 'scribe-react-common/src/components/SlugActionBar'
import { Collection, CollectionSlug, NoteSlugRow } from 'scribe-data'
import { getDraftSummariesForCollection, getBlockUuidsWithDrafts, type DraftSummary } from 'scribe-react-note/src/drafts/draftStorage'
import { useBottomNav } from 'scribe-react-common/src/context/bottomNavContext'
import { useRouteContext } from 'scribe-react-common/src/context/routeContext'

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

  /** Slugs that collide within this parent collection (notes + collections sharing a slug). */
  collidingSlugs?: Set<string>
}

const NoteListView: React.FC<NoteListViewProps> = ({
  collections, notes, prefix, slugPath,
  libraryName, syncProgress,
  collection, ancestors, collidingSlugs
}) => {
  const navigate = useNavigate()
  const { setFloatingAction } = useBottomNav()
  const routeCtx = useRouteContext()
  const isRoot = !collection

  // Set the floating action buttons for "Add Note", "Add Image", and "Add Collection"
  useEffect(() => {
    const base = slugPath ? `${slugPath}/` : ''
    const newNoteUrl = routeCtx.buildPath(`${base}+note`)
    const newImageUrl = routeCtx.buildPath(`${base}+image`)
    const newCollectionUrl = routeCtx.buildPath(`${base}+collection`)
    setFloatingAction([
      { icon: PlusIcon, label: 'Add Note', to: newNoteUrl },
      { icon: PhotoIcon, label: 'Add Image', to: newImageUrl },
      { icon: FolderPlusIcon, label: 'Add Collection', to: newCollectionUrl },
    ])
    return () => setFloatingAction(null)
  }, [routeCtx, slugPath, setFloatingAction])

  const showSyncProgress = syncProgress && !syncProgress.synced

  // Determine which collection id to use for draft queries
  const collectionId = collection?.collection_uuid ?? null

  // Get draft data for this collection
  const { newNoteDrafts, draftBlockUuids } = useMemo(() => {
    const summaries = getDraftSummariesForCollection(prefix, collectionId)
    const newNoteDrafts = summaries.filter((d) => d.blockUuid === null)
    const draftBlockUuids = getBlockUuidsWithDrafts(prefix)
    return { newNoteDrafts, draftBlockUuids }
  }, [prefix, collectionId])

  // Sort notes: those with drafts first, then by date
  const sortedNotes = useMemo(() => {
    return [...notes].sort((a, b) => {
      const aDraft = draftBlockUuids.has(a.block_uuid) ? 0 : 1
      const bDraft = draftBlockUuids.has(b.block_uuid) ? 0 : 1
      if (aDraft !== bDraft) return aDraft - bDraft
      return new Date(b.insert_datetime).getTime() - new Date(a.insert_datetime).getTime()
    })
  }, [notes, draftBlockUuids])

  const handleNewNote = () => {
    navigate(routeCtx.buildPath(slugPath ? `${slugPath}/+note` : '+note'))
  }

  const handleBack = () => {
    if (isRoot) {
      navigate('/')
    } else {
      navigate(routeCtx.buildPath())
    }
  }

  const linkPrefix = routeCtx.buildPath(slugPath || undefined).replace(/\/$/, '')

  const totalItems = notes.length + collections.length + newNoteDrafts.length

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header group: sync banner + nav header */}
      <div className="sticky top-0 z-40">
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
                <ArrowLeftIcon className="w-4 h-4" />
              </button>
              <h1 className="text-xl font-bold text-gray-900">{isRoot ? (libraryName || 'Notes') : (collection?.title || 'Collection')}</h1>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(routeCtx.buildPath('search'))}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <MagnifyingGlassIcon className="w-4 h-4 md:mr-1.5" />
                <span className="hidden md:inline">Search</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumbs + Move button (collection view only) */}
        {!isRoot && collection && ancestors && (
          <SlugActionBar
            ancestors={ancestors}
            prefix={prefix}
            slugPath={slugPath}
            entityType="collection"
            entityId={collection.collection_uuid}
            onMoved={(newSlugPath) => navigate(routeCtx.buildPath(newSlugPath))}
          />
        )}

        {totalItems === 0 ? (
          showSyncProgress ? (
            <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
              <div className="mx-auto w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4"></div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Syncing {syncProgress.currentIndex}/{syncProgress.finalIndex} blocks
              </h3>
              <p className="text-gray-600 text-sm">Notes will appear as they are synced</p>
            </div>
          ) : syncProgress && syncProgress.synced ? (
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
          ) : (
            <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
              <div className="mx-auto w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-3"></div>
            </div>
          )
        ) : (
          <>
            {/* Collections */}
            {collections.length > 0 && (
              <div className="mb-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {collections.map(({ collection: col, slug: collectionSlug }) => {
                    const hasCollision = collectionSlug ? collidingSlugs?.has(collectionSlug) : false
                    return (
                      <Link
                        key={col.collection_uuid}
                        to={collectionSlug ? `${linkPrefix}/${collectionSlug}` : routeCtx.buildPath()}
                        className="group block"
                      >
                        <div className={`bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden transform hover:-translate-y-1 ${
                          hasCollision
                            ? 'border border-orange-200 hover:border-orange-300'
                            : 'border border-gray-100 hover:border-amber-200'
                        }`}>
                          <div className="px-6 py-6">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                                <FolderIcon className="w-6 h-6 text-amber-600" />
                              </div>
                              <h3 className="text-lg font-bold text-gray-900 truncate group-hover:text-amber-600 transition-colors">
                                {col.title}
                              </h3>
                              {hasCollision && (
                                <ExclamationTriangleIcon className="w-4 h-4 text-orange-500 flex-shrink-0" title="Slug collision" />
                              )}
                            </div>
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Notes (new-note drafts first, then persisted notes sorted with drafts on top) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {/* New-note drafts */}
              {newNoteDrafts.map((draft) => (
                <Link
                  key={`draft-${draft.draftId}`}
                  to={slugPath
                    ? `${linkPrefix}/+draft/${draft.draftId}`
                    : routeCtx.buildPath(`+draft/${draft.draftId}`)}
                  className="group block"
                >
                  <div className="bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-amber-200 hover:border-amber-300 transform hover:-translate-y-1">
                    <div className="px-6 py-8">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-xl font-bold text-gray-900 truncate group-hover:text-amber-600 transition-colors mb-2">
                            {draft.title || 'Untitled'}
                          </h3>
                        </div>
                        <div className="flex-shrink-0">
                          <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                            <PencilSquareIcon className="w-6 h-6 text-amber-600" />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                        <span className="text-sm text-gray-500">
                          {new Date(draft.updatedAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </span>
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                          Draft
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}

              {/* Persisted notes and images */}
              {sortedNotes.map((note) => {
                const hasDraft = draftBlockUuids.has(note.block_uuid)
                const hasCollision = collidingSlugs?.has(note.slug)
                const isImage = note.block_type === 'scribe/image'

                // Color scheme: amber for drafts, green for images, blue for notes
                const colorScheme = hasDraft ? 'amber' : isImage ? 'green' : 'blue'
                const borderClass = hasDraft
                  ? 'border border-amber-200 hover:border-amber-300'
                  : hasCollision
                    ? 'border border-orange-200 hover:border-orange-300'
                    : isImage
                      ? 'border border-gray-100 hover:border-green-200'
                      : 'border border-gray-100 hover:border-blue-200'
                const hoverTextClass = colorScheme === 'amber'
                  ? 'group-hover:text-amber-600'
                  : colorScheme === 'green'
                    ? 'group-hover:text-green-600'
                    : 'group-hover:text-blue-600'
                const iconBgClass = colorScheme === 'amber'
                  ? 'bg-amber-50 group-hover:bg-amber-100'
                  : colorScheme === 'green'
                    ? 'bg-green-50 group-hover:bg-green-100'
                    : 'bg-blue-50 group-hover:bg-blue-100'
                const slugBadgeClass = colorScheme === 'amber'
                  ? 'bg-amber-50 text-amber-700'
                  : colorScheme === 'green'
                    ? 'bg-green-50 text-green-700'
                    : 'bg-blue-50 text-blue-700'

                return (
                  <Link
                    key={note.block_uuid}
                    to={`${linkPrefix}/${note.slug}${hasDraft ? '&edit' : ''}`}
                    className="group block"
                  >
                    <div className={`bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden transform hover:-translate-y-1 ${borderClass}`}>
                      <div className="px-6 py-8">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex-1 min-w-0">
                            <h3 className={`text-xl font-bold text-gray-900 truncate transition-colors mb-2 ${hoverTextClass}`}>
                              {note.title || 'Untitled'}
                            </h3>
                          </div>
                          <div className="flex-shrink-0">
                            <div className={`h-10 w-10 rounded-lg flex items-center justify-center transition-colors ${iconBgClass}`}>
                              {hasDraft ? (
                                <PencilSquareIcon className="w-6 h-6 text-amber-600" />
                              ) : isImage ? (
                                <PhotoIcon className="w-6 h-6 text-green-600" />
                              ) : (
                                <DocumentTextIcon className="w-6 h-6 text-blue-600" />
                              )}
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
                          <div className="flex items-center gap-2">
                            {hasCollision && (
                              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-orange-50 text-orange-700">
                                <ExclamationTriangleIcon className="w-3 h-3" />
                                Collision
                              </span>
                            )}
                            {hasDraft && (
                              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                                Draft
                              </span>
                            )}
                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${slugBadgeClass}`}>
                              {note.slug}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </>
        )}

      </div>

    </div>
  )
}

export default NoteListView
