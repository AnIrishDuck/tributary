import React, { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { useSyncStatus } from '../context/syncStatusContext'
import { PencilIcon, PlusIcon, ArrowLeftIcon, DocumentTextIcon } from '@heroicons/react/24/outline'
import { renderMarkdown } from '../utils/markdown'

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

interface BlockResultRow {
  body: string;
}

const NoteViewPage: React.FC = () => {
  const [content, setContent] = useState<string>('')
  const [title, setTitle] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [duplicateNotes, setDuplicateNotes] = useState<BlockSlugInfo[] | null>(null)
  const navigate = useNavigate()
  const { client } = useTributary()
  const { setFocusedLibrary } = useSyncStatus()

  // Extract the library prefix, slug, and optional uuid from params
  const { prefix, slug, uuid } = useParams()

  // Focus sync on this library while the page is mounted
  useEffect(() => {
    if (prefix) {
      setFocusedLibrary(prefix)
      return () => setFocusedLibrary(null)
    }
  }, [prefix, setFocusedLibrary])

  useEffect(() => {
    const loadNote = async () => {
      if (!client || !prefix || !slug) {
        setError('Missing required parameters')
        setIsLoading(false)
        return
      }

      try {
        // Extract library ID from prefix (format: base64url-public-key)
        const streamId = prefix

        // Get the library
        const stream = await client.get('scribe', streamId)

        if (!stream) {
          throw new Error('Failed to get library')
        }

        // Create local database for querying
        const localDb = stream.local()

        // Import scribe-data functions
        const { getNotesBySlug, getNoteSlugByUuid, getAuthoritativeVersionByNoteUuid } = await import('scribe-data')

        let blockSlugInfo: BlockSlugInfo | null = null

        if (uuid) {
          // Load specific note by UUID
          blockSlugInfo = await getNoteSlugByUuid(localDb, uuid) as BlockSlugInfo | null
          if (!blockSlugInfo) {
            throw new Error('Note not found')
          }
        } else {
          // Look up all notes matching this slug
          const matchingNotes = await getNotesBySlug(localDb, slug) as BlockSlugInfo[]

          if (matchingNotes.length === 0) {
            throw new Error('Note not found')
          }

          if (matchingNotes.length > 1) {
            // Multiple notes share this slug — show duplicate listing
            setDuplicateNotes(matchingNotes)
            setIsLoading(false)
            return
          }

          // Single match — load it directly
          blockSlugInfo = matchingNotes[0]
        }

        // Get the authoritative version
        const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, blockSlugInfo.block_uuid) as AuthoritativeVersion | null

        if (!authoritativeVersion) {
          throw new Error('Note version not found')
        }

        // Get the actual note content
        const blockResult = await localDb.query(
          `SELECT body FROM block WHERE block_uuid = $1 AND version_uuid = $2`,
          [blockSlugInfo.block_uuid, authoritativeVersion.version_uuid]
        )

        if (!blockResult.rows || blockResult.rows.length === 0) {
          throw new Error('Note content not found')
        }

        const blockContent = (blockResult.rows[0] as BlockResultRow).body

        setContent(blockContent)
        setTitle(blockSlugInfo.title || slug || '')
      } catch (err: any) {
        setError('Failed to load note: ' + (err.message || 'Unknown error'))
        console.error('Error loading note:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadNote()
  }, [client, prefix, slug, uuid])

  const handleEdit = () => {
    if (prefix && slug) {
      if (uuid) {
        navigate(`/pk/${prefix}/${slug}/${uuid}/edit`)
      } else {
        navigate(`/pk/${prefix}/${slug}/edit`)
      }
    }
  }

  const handleNewNote = () => {
    if (prefix) {
      navigate(`/pk/${prefix}/new`)
    }
  }

  const handleBack = () => {
    if (prefix) {
      navigate(`/pk/${prefix}/`)
    } else {
      navigate('/')
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-4">
        <div className="text-center">
          <div className="mx-auto w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-2"></div>
          <p className="text-sm text-gray-600">Loading note...</p>
        </div>
      </div>
    )
  }

  if (error) {
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
                <p className="text-red-700 mt-1 text-sm">{error}</p>
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

  // Duplicate slug listing page
  if (duplicateNotes) {
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
            <h2 className="text-xl font-bold text-gray-900 mb-2">Multiple notes match "{slug}"</h2>
            <p className="text-sm text-gray-500 mb-6">Select the note you want to view:</p>
            <div className="space-y-3">
              {duplicateNotes.map((note) => (
                <Link
                  key={note.block_uuid}
                  to={`/pk/${prefix}/${slug}/${note.block_uuid}`}
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
                onClick={handleNewNote}
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
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content, prefix || '', slug) }}
          />
        </div>
      </div>
    </div>
  )
}

export default NoteViewPage
