import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, Link } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { useSyncStatus } from '../context/syncStatusContext'
import { saveNote } from '../actions/saveNote'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorView } from '@codemirror/view'
import { NoteSlug, AuthoritativeVersion, Note } from 'scribe-data'
import { getAuthoritativeVersionByNoteUuid, getNoteByVersion } from 'scribe-data'
import { ArrowUpOnSquareIcon, XMarkIcon, DocumentTextIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import { useDraftAutoSave } from '../hooks/useDraftAutoSave'
import VersionFooter from '../components/VersionFooter'
import ConflictWarning from '../components/ConflictWarning'

export interface EditorPageProps {
  prefix: string
  collectionId?: string
  editBlockUuid?: string
  /** For resuming a new-note draft that was previously auto-saved. */
  draftId?: string
  cancelPath: string
  /** Optional initial title for new notes (used when creating from a missing slug). */
  initialTitle?: string
  /** Label of the collection this note belongs to, shown in the header. */
  collectionLabel?: string
  /** Full slug path of the note being edited (e.g. "cooking/italian/pasta-recipe"), shown as breadcrumbs. */
  noteSlugPath?: string
}

const EditorPage: React.FC<EditorPageProps> = ({ prefix, collectionId, editBlockUuid, draftId, cancelPath, initialTitle, collectionLabel, noteSlugPath }) => {
  const defaultContent = initialTitle ? `# ${initialTitle}\n\n` : '# New Note\n\nStart writing here...'
  const [content, setContent] = useState<string>(defaultContent)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [blockUuid, setBlockUuid] = useState<string | undefined>(undefined)
  const [versionUuid, setVersionUuid] = useState<string | undefined>(undefined)
  const [versionPosition, setVersionPosition] = useState<{ position: number; total: number } | null>(null)
  const [showConflictWarning, setShowConflictWarning] = useState(false)
  const loadedVersionUuidRef = useRef<string | null>(null)
  const navigate = useNavigate()
  const { client } = useTributary()
  const { syncStatus, setFocusedLibrary } = useSyncStatus()

  // Stable draft id: for existing notes use blockUuid; for new notes use
  // the provided draftId (resuming a draft) or generate a fresh one.
  const stableDraftId = useRef<string>(
    editBlockUuid ?? draftId ?? crypto.randomUUID()
  )

  // Keep a ref to the latest content so the auto-save hook can read it
  // without re-creating the interval on every keystroke.
  const contentRef = useRef(content)
  contentRef.current = content
  const getBody = useCallback(() => contentRef.current, [])
  const getBaseVersionUuid = useCallback(() => loadedVersionUuidRef.current, [])

  const { loadDraft, clearDraft, saveNow } = useDraftAutoSave({
    prefix,
    draftId: stableDraftId.current,
    blockUuid: editBlockUuid ?? null,
    collectionId: collectionId ?? null,
    getBody,
    getBaseVersionUuid,
  })

  // Focus sync on this library while the page is mounted
  useEffect(() => {
    if (prefix) {
      setFocusedLibrary(prefix)
      return () => setFocusedLibrary(null)
    }
  }, [prefix, setFocusedLibrary])

  // Determine if this is a new note or editing an existing one
  const isNewNote = !editBlockUuid

  // Check if THIS library is synced (not the global status, which can be blocked
  // by other libraries that aren't being synced due to the focused-library optimization)
  const librarySyncStatus = prefix ? syncStatus[prefix] : undefined
  const isSyncing = librarySyncStatus?.isSyncing ?? false
  const isSynced = librarySyncStatus?.synced ?? false

  // For new notes, check for an existing draft on mount.
  useEffect(() => {
    if (isNewNote) {
      const draft = loadDraft()
      if (draft) setContent(draft.body)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // If editing an existing note, load it once synced — but prefer a local draft.
  useEffect(() => {
    const loadNoteForEditing = async () => {
      if (!isSynced) return
      if (!isNewNote && editBlockUuid && client && prefix) {
        try {
          const streamId = prefix
          const stream = await client.get('scribe', streamId)

          if (!stream) {
            throw new Error('Failed to get library')
          }

          const localDb = stream.local()

          // Load note by block UUID
          const { getNoteSlugByUuid } = await import('scribe-data')
          let noteSlugInfo: NoteSlug | null = null
          noteSlugInfo = await getNoteSlugByUuid(localDb, editBlockUuid) as NoteSlug | null

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

          setVersionUuid(authoritativeVersion.version_uuid)

          // Prefer local draft over server content. When a draft exists,
          // use its baseVersionUuid for conflict detection so we can detect
          // if the authoritative version changed while the user was away.
          const draft = loadDraft()
          if (draft) {
            loadedVersionUuidRef.current = draft.baseVersionUuid ?? authoritativeVersion.version_uuid
            setContent(draft.body)
          } else {
            loadedVersionUuidRef.current = authoritativeVersion.version_uuid
            setContent(note.body)
          }

          // Fetch version position info
          try {
            const { getVersionPosition } = await import('scribe-data')
            const pos = await getVersionPosition(localDb, noteSlugInfo.block_uuid, authoritativeVersion.version_uuid)
            if (pos) {
              setVersionPosition({ position: pos.position, total: pos.total })
            }
          } catch {
            // Silently ignore version info errors
          }
        } catch (err: any) {
          setError('Failed to load note: ' + (err.message || 'Unknown error'))
          console.error('Error loading note:', err)
        }
      }
    }

    loadNoteForEditing()
  }, [isNewNote, editBlockUuid, client, prefix, isSynced, loadDraft])

  // Detect version conflicts: when lastSyncedAt changes, check if the
  // authoritative version has diverged from the one we loaded.
  const lastSyncedAt = librarySyncStatus?.lastSyncedAt ?? null
  useEffect(() => {
    if (!editBlockUuid || !client || !prefix || !loadedVersionUuidRef.current) return
    if (!lastSyncedAt) return

    const checkForConflict = async () => {
      try {
        const stream = await client.get('scribe', prefix)
        if (!stream) return
        const localDb = stream.local()
        const authVersion = await getAuthoritativeVersionByNoteUuid(localDb, editBlockUuid) as AuthoritativeVersion | null
        if (!authVersion) return
        if (authVersion.version_uuid !== loadedVersionUuidRef.current) {
          setShowConflictWarning(true)
        }
      } catch {
        // Silently ignore conflict check errors
      }
    }

    checkForConflict()
  }, [editBlockUuid, client, prefix, lastSyncedAt])

  const onConflictReload = useCallback(async () => {
    if (!editBlockUuid || !client || !prefix) return
    try {
      // Save the current draft before reloading
      saveNow()

      const stream = await client.get('scribe', prefix)
      if (!stream) return
      const localDb = stream.local()

      const authVersion = await getAuthoritativeVersionByNoteUuid(localDb, editBlockUuid) as AuthoritativeVersion | null
      if (!authVersion) return

      const note = await getNoteByVersion(localDb, editBlockUuid, authVersion.version_uuid)
      if (!note) return

      // Update content and version tracking
      setContent(note.body)
      setVersionUuid(authVersion.version_uuid)
      loadedVersionUuidRef.current = authVersion.version_uuid

      // Update version position
      try {
        const { getVersionPosition } = await import('scribe-data')
        const pos = await getVersionPosition(localDb, editBlockUuid, authVersion.version_uuid)
        if (pos) {
          setVersionPosition({ position: pos.position, total: pos.total })
        }
      } catch {
        // Silently ignore version info errors
      }

      setShowConflictWarning(false)
    } catch (err: any) {
      setError('Failed to reload note: ' + (err.message || 'Unknown error'))
    }
  }, [editBlockUuid, client, prefix, saveNow])

  const onConflictDismiss = useCallback(() => {
    setShowConflictWarning(false)
  }, [])

  // If editing an existing note and this library hasn't synced yet, show a waiting
  // screen. New notes don't need to wait — there's no existing content to load.
  if (!isNewNote && !isSynced) {
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

      const { block, blockSlug: blockSlugResult } = await saveNote(stream, content, 'web-ui', blockUuid, collectionId)

      // Successful save — clear the local draft
      clearDraft()

      // After saving, navigate to the note view using its full slug path
      if (prefix) {
        try {
          const { getNoteSlugPath } = await import('scribe-data')
          const localDb = stream.local()
          const slugPathSegments = await getNoteSlugPath(localDb, block.block_uuid)
          if (slugPathSegments.length > 0) {
            navigate(`/pk/${prefix}/${slugPathSegments.join('/')}`)
          } else {
            navigate(`/pk/${prefix}/`)
          }
        } catch {
          // Fallback to flat slug if path resolution fails
          const slug = (blockSlugResult as any)?.slug
          if (slug && typeof slug === 'string') {
            navigate(`/pk/${prefix}/${slug}`)
          } else {
            navigate(`/pk/${prefix}/`)
          }
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
      {/* Conflict Warning Banner */}
      {showConflictWarning && (
        <ConflictWarning onReload={onConflictReload} onDismiss={onConflictDismiss} />
      )}

      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">
                {collectionLabel || (isNewNote ? 'New Note' : 'Edit Note')}
              </h1>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  clearDraft()
                  navigate(cancelPath)
                }}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <XMarkIcon className="w-4 h-4 mr-1.5" />
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {noteSlugPath && (
          <nav className="flex items-baseline text-sm text-gray-500 mb-4 overflow-hidden whitespace-nowrap">
            <Link to={`/pk/${prefix}/`} className="hover:text-blue-600 transition-colors flex-shrink-0">/</Link>
            {noteSlugPath.split('/').filter(Boolean).map((segment, i, arr) => {
              const path = arr.slice(0, i + 1).join('/')
              const isLast = i === arr.length - 1
              return (
                <React.Fragment key={i}>
                  {i > 0 ? (
                    <span className="mx-1 text-gray-400 flex-shrink-0">/</span>
                  ) : (
                    <span className="ml-1 flex-shrink-0" />
                  )}
                  {isLast ? (
                    <span className="text-gray-900 font-medium flex-shrink-0">{segment}</span>
                  ) : (
                    <Link to={`/pk/${prefix}/${path}`} className="hover:text-blue-600 transition-colors flex-shrink-0">{segment}</Link>
                  )}
                </React.Fragment>
              )
            })}
          </nav>
        )}
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
              className="border-0 rounded-b-xl !bg-white w-full h-full [&_.cm-editor]:!h-full [&_.cm-scroller]:!overflow-auto"
              style={{
                fontSize: '14px',
                fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace'
              }}
              extensions={[
                markdown({ base: markdownLanguage, codeLanguages: languages }),
                EditorView.lineWrapping,
              ]}
              onChange={(value) => setContent(value)}
            />
          </div>

          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between pb-safe">
            <div className="flex items-center gap-4 text-sm text-gray-500">
              <span className="flex items-center">
                <DocumentTextIcon className="w-4 h-4 mr-2" />
                <span>{content.length} characters</span>
              </span>
              {versionUuid && versionPosition && (
                <VersionFooter
                  versionUuid={versionUuid}
                  position={versionPosition.position}
                  total={versionPosition.total}
                />
              )}
            </div>
            <div className="text-xs text-gray-400">
              Markdown supported
            </div>
          </div>
        </div>
      </div>

      {/* Save FAB */}
      <button
        onClick={onSaveNote}
        disabled={isLoading}
        className="fixed z-50 right-4 md:right-8 fab-bottom md:bottom-8 flex items-center justify-center w-14 h-14 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 text-white"
        aria-label={isNewNote ? 'Add Note' : 'Update Note'}
      >
        {isLoading ? (
          <svg className="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : (
          <ArrowUpOnSquareIcon className="w-6 h-6" />
        )}
      </button>
    </div>
  )
}

export default EditorPage
