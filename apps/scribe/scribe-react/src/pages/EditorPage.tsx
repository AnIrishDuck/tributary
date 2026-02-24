import React, { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { useSyncStatus } from '../context/syncStatusContext'
import { saveNote } from '../actions/saveNote'
import * as base64url from 'urlsafe-base64'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { NoteSlug, AuthoritativeVersion, Note } from 'scribe-data'
import { getNoteBySlug, getAuthoritativeVersionByNoteUuid, getNoteByVersion } from 'scribe-data'
import { ArrowUpOnSquareIcon, XMarkIcon, DocumentTextIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'

const EditorPage: React.FC = () => {
  const [content, setContent] = useState<string>('# New Note\n\nStart writing here...')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [blockUuid, setBlockUuid] = useState<string | undefined>(undefined)
  const navigate = useNavigate()
  const { client } = useTributary()
  const { globalSyncStatus, setFocusedLibrary } = useSyncStatus()
  
  // Extract the library prefix, optional slug, and optional uuid from params
  const { prefix, slug, uuid } = useParams()

  // Focus sync on this library while the page is mounted
  useEffect(() => {
    if (prefix) {
      setFocusedLibrary(prefix)
      return () => setFocusedLibrary(null)
    }
  }, [prefix, setFocusedLibrary])

  // Determine if this is a new note:
  // - For /pk/:prefix/new route, slug is undefined
  // - For /pk/:prefix/:slug/edit route, slug is the note slug
  const isNewNote = !slug || slug === 'new'

  // Check if we're currently syncing
  const isSyncing = globalSyncStatus?.isSyncing ?? false
  const isSynced = globalSyncStatus?.synced ?? false

  // If editing an existing note, load it once synced
  useEffect(() => {
    const loadNoteForEditing = async () => {
      if (!isSynced) return
      if (!isNewNote && slug && slug !== 'new' && client && prefix) {
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
          
          // Get the note slug info — by UUID if provided, otherwise by slug
          let noteSlugInfo: NoteSlug | null = null
          if (uuid) {
            const { getNoteSlugByUuid } = await import('scribe-data')
            noteSlugInfo = await getNoteSlugByUuid(localDb, uuid) as NoteSlug | null
          } else {
            noteSlugInfo = await getNoteBySlug(localDb, slug) as NoteSlug | null
          }

          if (!noteSlugInfo) {
            throw new Error('Note not found')
          }

          // Store the block UUID for updates
          setBlockUuid(noteSlugInfo.block_uuid)
          
          // Get the authoritative version
          const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, noteSlugInfo.block_uuid) as AuthoritativeVersion | null
          
          if (!authoritativeVersion) {
            throw new Error('Note version not found')
          }
          
          // Get the actual note content using scribe-data functions
          const note = await getNoteByVersion(localDb, noteSlugInfo.block_uuid, authoritativeVersion.version_uuid)
          
          if (!note) {
            throw new Error('Note content not found')
          }
          
          setContent(note.body)
        } catch (err: any) {
          setError('Failed to load note: ' + (err.message || 'Unknown error'))
          console.error('Error loading note:', err)
        }
      }
    }

    loadNoteForEditing()
  }, [isNewNote, slug, uuid, client, prefix, isSynced])

  // If not synced, show a waiting screen
  if (!isSynced) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="text-center max-w-lg">
          <div className="bg-blue-50 rounded-2xl p-8 mb-6">
            <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              {isSyncing ? (
                <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <ExclamationCircleIcon className="w-8 h-8 text-blue-600" />
              )}
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {isSyncing ? 'Syncing Notes' : 'Notes Still Syncing'}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {isSyncing
                ? 'Please wait while we sync the latest changes from the server.'
                : 'Some notes are still syncing. Please wait a moment before making edits.'}
            </p>
          </div>
          <p className="text-xs text-gray-400">
            Edits will be available once syncing is complete.
          </p>
        </div>
      </div>
    )
  }

  const onSaveNote = async () => {
    if (!client) {
      setError('Tributary client not available')
      return
    }

    setIsLoading(true)
    setError(null)
    
    try {
      // Extract library ID from prefix (format: base64url-public-key)
      if (!prefix) {
        throw new Error('No library prefix provided')
      }

      // The prefix is already the base64url-public-key part
      const streamId = prefix

      // Get the library
      const stream = await client.get('scribe', streamId)

      if (!stream) {
        throw new Error('Failed to get library')
      }
      
      const { block, blockSlug: blockSlugResult } = await saveNote(stream, content, 'web-ui', blockUuid)
      
      // After saving, navigate to the note view using the slug
      if (prefix) {
        // Type assertion since saveNote returns blockSlug as any
        const slug = (blockSlugResult as any)?.slug
        if (slug && typeof slug === 'string') {
          navigate(`/pk/${prefix}/${slug}`)
        } else {
          navigate(`/pk/${prefix}/`)
        }
      } else {
        navigate('/')
      }
    } catch (err: any) {
      setError('Failed to save note: ' + (err.message || 'Unknown error'))
      console.error('Error saving note:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">
                {isNewNote ? 'New Note' : 'Edit Note'}
              </h1>
            </div>
            
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => prefix ? navigate(`/pk/${prefix}/`) : navigate('/')}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <XMarkIcon className="w-4 h-4 mr-1.5" />
                Cancel
              </button>
              
              <button 
                onClick={onSaveNote}
                disabled={isLoading}
                className={`inline-flex items-center px-4 py-1.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white ${
                  isLoading 
                    ? 'bg-blue-400 cursor-not-allowed' 
                    : 'bg-blue-600 hover:bg-blue-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200`}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-1.5 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </>
                ) : (
                  <>
                    <ArrowUpOnSquareIcon className="w-4 h-4 mr-1.5" />
                    {isNewNote ? 'Add Note' : 'Update Note'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 animate-fade-in">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}
        
        <div className="card shadow-lg overflow-hidden flex flex-col h-[calc(100dvh-250px)]">
          <div className="flex-1 overflow-hidden">
            <CodeMirror
              value={content}
              className="border-0 rounded-b-xl !bg-white w-full h-full"
              style={{
                fontSize: '14px',
                fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace'
              }}
              extensions={[markdown({ base: markdownLanguage, codeLanguages: languages })]}
              onChange={(value) => setContent(value)}
            />
          </div>
          
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between pb-safe">
            <div className="flex items-center text-sm text-gray-500">
              <DocumentTextIcon className="w-4 h-4 mr-2" />
              <span>{content.length} characters</span>
            </div>
            <div className="text-xs text-gray-400">
              Markdown supported
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EditorPage
