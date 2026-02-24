import React, { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { useSyncStatus } from '../context/syncStatusContext'
import { PencilIcon, PlusIcon, ArrowLeftIcon, DocumentTextIcon, FolderIcon, FolderPlusIcon } from '@heroicons/react/24/outline'
import { renderMarkdown } from '../utils/markdown'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { Collection, CollectionSlug, NoteSlugRow } from 'scribe-data'

interface BlockSlugInfo {
  block_uuid: string;
  slug: string;
  title: string;
  indexed_at: string;
}

interface AuthoritativeVersion {
  block_uuid: string;
  version_uuid: string;
  indexed_at: string;
}

type PageMode =
  | { type: 'loading' }
  | { type: 'error'; message: string }
  | { type: 'note'; content: string; title: string; slugPath: string }
  | { type: 'duplicateNotes'; notes: BlockSlugInfo[]; slugPath: string }
  | { type: 'collection'; collection: CollectionSlug; ancestors: Collection[]; childCollections: { collection: Collection; slug: string | null }[]; notes: NoteSlugRow[]; slugPath: string }
  | { type: 'disambiguation'; notes: BlockSlugInfo[]; collections: CollectionSlug[]; slugPath: string }

const NoteViewPage: React.FC = () => {
  const [mode, setMode] = useState<PageMode>({ type: 'loading' })
  const navigate = useNavigate()
  const { client } = useTributary()
  const { setFocusedLibrary } = useSyncStatus()

  // Extract the library prefix and splat path from params
  const params = useParams()
  const prefix = params.prefix
  const splatPath = params['*'] || ''

  // Focus sync on this library while the page is mounted
  useEffect(() => {
    if (prefix) {
      setFocusedLibrary(prefix)
      return () => setFocusedLibrary(null)
    }
  }, [prefix, setFocusedLibrary])

  useEffect(() => {
    const loadContent = async () => {
      if (!client || !prefix || !splatPath) {
        setMode({ type: 'error', message: 'Missing required parameters' })
        return
      }

      try {
        const streamId = prefix
        const stream = await client.get('scribe', streamId)

        if (!stream) {
          throw new Error('Failed to get library')
        }

        const localDb = stream.local()

        const {
          getAuthoritativeVersionByNoteUuid, getNoteByVersion,
          getLibrary, getCollectionByUuid, getChildCollections,
          getCollectionAncestors, getNotesInCollectionWithSlugs, titleToSlug,
          resolveSlugPath, getSlugPath, getNoteSlugByUuid
        } = await import('scribe-data')

        // Parse the splat path into segments
        let segments = splatPath.split('/').filter(Boolean)

        // Check if last segment is 'edit' — if so, strip it and redirect to editor
        const isEdit = segments.length > 0 && segments[segments.length - 1] === 'edit'
        if (isEdit) {
          segments = segments.slice(0, -1)
        }

        if (segments.length === 0) {
          throw new Error('Not found')
        }

        // Get library root for scoped resolution
        const library = await getLibrary(localDb)
        if (!library) {
          throw new Error('Library not found')
        }

        // Check if the last segment looks like a UUID (for disambiguation links)
        const lastSegment = segments[segments.length - 1]
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (uuidPattern.test(lastSegment)) {
          // Direct UUID access — load the note directly
          const blockSlugInfo = await getNoteSlugByUuid(localDb, lastSegment) as BlockSlugInfo | null
          if (!blockSlugInfo) {
            throw new Error('Note not found')
          }

          if (isEdit) {
            // For edit mode with UUID, navigate to the legacy editor route
            navigate(`/pk/${prefix}/new?edit=${lastSegment}`, { replace: true })
            return
          }

          const noteContent = await loadNoteContent(localDb, blockSlugInfo, getAuthoritativeVersionByNoteUuid, getNoteByVersion)
          const fullSlugPath = segments.join('/')
          setMode({ type: 'note', content: noteContent, title: blockSlugInfo.title || '', slugPath: fullSlugPath })
          return
        }

        // Use hierarchical slug resolution
        const resolved = await resolveSlugPath(localDb, segments, library.collection_uuid)

        if (!resolved) {
          throw new Error('Not found')
        }

        const fullSlugPath = segments.join('/')

        if (resolved.type === 'note') {
          if (isEdit) {
            // Redirect to editor with block UUID
            navigate(`/pk/${prefix}/new?edit=${resolved.entity.block_uuid}`, { replace: true })
            return
          }

          const blockSlugInfo = resolved.entity as BlockSlugInfo
          const noteContent = await loadNoteContent(localDb, blockSlugInfo, getAuthoritativeVersionByNoteUuid, getNoteByVersion)
          setMode({ type: 'note', content: noteContent, title: blockSlugInfo.title || '', slugPath: fullSlugPath })
          return
        }

        if (resolved.type === 'collection') {
          const col = resolved.entity as CollectionSlug

          if (isEdit) {
            // Collections don't have edit mode, redirect to the collection view
            navigate(`/pk/${prefix}/${fullSlugPath}`, { replace: true })
            return
          }

          const collectionData = await loadCollectionData(
            localDb, col, getCollectionByUuid, getChildCollections,
            getCollectionAncestors, getNotesInCollectionWithSlugs, titleToSlug,
            fullSlugPath
          )
          setMode({ type: 'collection', ...collectionData, slugPath: fullSlugPath })
          return
        }
      } catch (err: any) {
        setMode({ type: 'error', message: 'Failed to load note: ' + (err.message || 'Unknown error') })
        console.error('Error loading content:', err)
      }
    }

    loadContent()
  }, [client, prefix, splatPath])

  const handleEdit = () => {
    if (prefix && mode.type === 'note') {
      navigate(`/pk/${prefix}/${(mode as any).slugPath}/edit`)
    }
  }

  const handleNewNote = (collectionUuid?: string) => {
    if (prefix) {
      if (collectionUuid) {
        navigate(`/pk/${prefix}/new?collection=${collectionUuid}`)
      } else {
        navigate(`/pk/${prefix}/new`)
      }
    }
  }

  const handleBack = () => {
    if (prefix) {
      navigate(`/pk/${prefix}/`)
    } else {
      navigate('/')
    }
  }

  if (mode.type === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-4">
        <div className="text-center">
          <div className="mx-auto w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-2"></div>
          <p className="text-sm text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (mode.type === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 py-4">
        <div className="max-w-3xl mx-auto px-4">
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-500 mt-0.5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-red-900">Error loading note</h3>
                <p className="text-red-700 mt-1 text-sm">{mode.message}</p>
              </div>
            </div>
          </div>
          <button
            onClick={handleBack}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
            Back
          </button>
        </div>
      </div>
    )
  }

  // Duplicate slug listing page (notes only)
  if (mode.type === 'duplicateNotes') {
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
            <h2 className="text-xl font-bold text-gray-900 mb-2">Multiple notes match "{splatPath}"</h2>
            <p className="text-sm text-gray-500 mb-6">Select the note you want to view:</p>
            <div className="space-y-3">
              {mode.notes.map((note) => (
                <Link
                  key={note.block_uuid}
                  to={`/pk/${prefix}/${mode.slugPath}/${note.block_uuid}`}
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
        </div>
      </div>
    )
  }

  // Disambiguation page (both notes and collections match)
  if (mode.type === 'disambiguation') {
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
            <h2 className="text-xl font-bold text-gray-900 mb-2">Multiple items match "{splatPath}"</h2>
            <p className="text-sm text-gray-500 mb-6">Select the item you want to view:</p>

            {mode.collections.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Collections</h3>
                <div className="space-y-3">
                  {mode.collections.map((col) => (
                    <Link
                      key={col.collection_uuid}
                      to={`/pk/${prefix}/${mode.slugPath}`}
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

            {mode.notes.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Notes</h3>
                <div className="space-y-3">
                  {mode.notes.map((note) => (
                    <Link
                      key={note.block_uuid}
                      to={`/pk/${prefix}/${mode.slugPath}/${note.block_uuid}`}
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

  // Collection view
  if (mode.type === 'collection') {
    const currentSlugPath = mode.slugPath
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
                  onClick={() => handleNewNote(mode.collection.collection_uuid)}
                  className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
                >
                  <PlusIcon className="w-4 h-4 mr-1.5" />
                  New Note
                </button>
                <button
                  onClick={() => {
                    if (prefix) {
                      navigate(`/pk/${prefix}/new-collection?parent=${mode.collection.collection_uuid}`)
                    }
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
          <Breadcrumbs ancestors={mode.ancestors} prefix={prefix || ''} />

          <h1 className="text-2xl font-bold text-gray-900 mb-6">{mode.collection.title}</h1>

          {/* Child collections */}
          {mode.childCollections.length > 0 && (
            <div className="mb-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {mode.childCollections.map(({ collection: child, slug: childSlug }) => (
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
          {mode.notes.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {mode.notes.map((note) => (
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
          ) : mode.childCollections.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
              <div className="mx-auto w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                <DocumentTextIcon className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Empty collection</h3>
              <p className="text-gray-600 mb-6 text-sm">Add notes or subcollections to get started</p>
              <button
                onClick={() => handleNewNote(mode.collection.collection_uuid)}
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

  // Note view (default)
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
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
                onClick={handleEdit}
                className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <PencilIcon className="w-4 h-4 mr-1.5" />
                Edit
              </button>

              <button
                onClick={() => handleNewNote()}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <PlusIcon className="w-4 h-4 mr-1.5" />
                New
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-xl shadow overflow-hidden p-6 md:p-8">
          <div
            className="prose prose-lg max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(mode.content, prefix || '', splatPath) }}
          />
        </div>
      </div>
    </div>
  )
}

// Helper: load note content by block slug info
async function loadNoteContent(
  localDb: any,
  blockSlugInfo: BlockSlugInfo,
  getAuthoritativeVersionByNoteUuid: (db: any, uuid: string) => Promise<any>,
  getNoteByVersion: (db: any, blockUuid: string, versionUuid: string) => Promise<any>
): Promise<string> {
  const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, blockSlugInfo.block_uuid) as AuthoritativeVersion | null

  if (!authoritativeVersion) {
    throw new Error('Note version not found')
  }

  const note = await getNoteByVersion(localDb, blockSlugInfo.block_uuid, authoritativeVersion.version_uuid)

  if (!note) {
    throw new Error('Note content not found')
  }

  return note.body
}

// Helper: load collection data for rendering
async function loadCollectionData(
  localDb: any,
  col: CollectionSlug,
  getCollectionByUuid: (db: any, uuid: string) => Promise<Collection | null>,
  getChildCollections: (db: any, parentUuid: string) => Promise<Collection[]>,
  getCollectionAncestors: (db: any, uuid: string) => Promise<Collection[]>,
  getNotesInCollectionWithSlugs: (db: any, collectionId: string | null) => Promise<NoteSlugRow[]>,
  titleToSlug: (title: string) => string,
  slugPath: string
) {
  const ancestors = await getCollectionAncestors(localDb, col.collection_uuid)
  const children = await getChildCollections(localDb, col.collection_uuid)
  const notes = await getNotesInCollectionWithSlugs(localDb, col.collection_uuid)

  // Get slugs for child collections
  const childCollections = children.map(child => ({
    collection: child,
    slug: titleToSlug(child.title) || null
  }))

  return { collection: col, ancestors, childCollections, notes }
}

export default NoteViewPage
