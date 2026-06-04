import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router'
import { PlusIcon, DocumentTextIcon, ArrowDownOnSquareIcon, Cog6ToothIcon, XMarkIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { useSyncStatus } from 'scribe-react-common/src/context/syncStatusContext'
import { getLibraries, getHomeCollections, importLibrary, createLibrary, titleToSlug, LibraryInfo } from 'scribe-data'
import { createLogger } from 'tributary-client'
import { CONFIG } from '../config'
import * as base64url from 'urlsafe-base64'

const { error: logError } = createLogger('scribe-react')

/**
 * Validate that a string is a plausible Ed25519 private key:
 * - valid base64url encoding
 * - decodes to exactly 64 bytes
 */
function validatePrivateKey(key: string): { valid: boolean; error?: string } {
  if (!key.trim()) return { valid: false }
  try {
    const decoded = base64url.decode(key.trim())
    if (decoded.length !== 64) {
      return { valid: false, error: 'Key must be 64 bytes (got ' + decoded.length + ')' }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid base64url encoding' }
  }
}

const ImportCard: React.FC<{
  onCancel: () => void
  onImported: () => void
  initialKey?: string
}> = ({ onCancel, onImported, initialKey }) => {
  const { client } = useTributary()
  const [privateKey, setPrivateKey] = useState(initialKey ?? '')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const navigate = useNavigate()

  const validation = privateKey ? validatePrivateKey(privateKey) : { valid: false }
  const showError = error || (privateKey.length > 0 && validation.error)

  const handleImport = async () => {
    if (!client || !validation.valid) return

    setImporting(true)
    setError(null)

    try {
      const { prefix } = await importLibrary(client, privateKey.trim())
      onImported()
      setTimeout(() => navigate(`/${prefix}/`), 0)
    } catch (err) {
      setError(`Failed to import: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="p-4 bg-white rounded-xl border border-blue-300 shadow-md">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-lg bg-green-100 text-green-600">
            <ArrowDownOnSquareIcon className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-medium text-gray-900">Import Library</h4>
            <p className="text-sm text-gray-500">Paste your private key below</p>
          </div>
        </div>
        <button
          onClick={onCancel}
          disabled={importing}
          className="flex-shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
          aria-label="Cancel import"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      <textarea
        rows={3}
        value={privateKey}
        onChange={(e) => { setPrivateKey(e.target.value); setError(null) }}
        disabled={importing}
        className={`block w-full rounded-lg border px-3 py-2 text-sm font-mono
          focus:ring-2 focus:ring-blue-500 focus:border-blue-500
          ${showError ? 'border-red-300' : 'border-gray-300'}
          shadow-sm resize-none disabled:opacity-50`}
        placeholder="Paste your private key (base64url encoded)"
      />

      {showError && (
        <p className="mt-1.5 text-xs text-red-600">{showError}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleImport}
          disabled={!validation.valid || importing}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {importing ? (
            <>
              <svg className="animate-spin -ml-0.5 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Importing...
            </>
          ) : (
            'Import'
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={importing}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

const CreateCard: React.FC<{
  onCancel: () => void
  onCreated: () => void
}> = ({ onCancel, onCreated }) => {
  const { client } = useTributary()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const handleCreate = async () => {
    if (!client || !name.trim()) return

    setCreating(true)
    setError(null)

    try {
      const homeStreamId = await client.getHomeStream()
      if (!homeStreamId) throw new Error('No home library configured')
      const homeStream = await client.get(CONFIG.APP_ID, homeStreamId)
      if (!homeStream) throw new Error('Could not load home library')

      const { prefix } = await createLibrary(client, name.trim(), homeStream)
      onCreated()
      setTimeout(() => navigate(`/${prefix}/`), 0)
    } catch (err) {
      setError(`Failed to create: ${(err as Error).message}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="p-4 bg-white rounded-xl border border-blue-300 shadow-md">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-lg bg-blue-100 text-blue-600">
            <PlusIcon className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-medium text-gray-900">Create Library</h4>
            <p className="text-sm text-gray-500">Enter a name for your new library</p>
          </div>
        </div>
        <button
          onClick={onCancel}
          disabled={creating}
          className="flex-shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
          aria-label="Cancel create"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      <input
        type="text"
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null) }}
        disabled={creating}
        className={`block w-full rounded-lg border px-3 py-2 text-sm
          focus:ring-2 focus:ring-blue-500 focus:border-blue-500
          ${error ? 'border-red-300' : 'border-gray-300'}
          shadow-sm disabled:opacity-50`}
        placeholder="Library name"
      />

      {error && (
        <p className="mt-1.5 text-xs text-red-600">{error}</p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={handleCreate}
          disabled={!name.trim() || creating}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? (
            <>
              <svg className="animate-spin -ml-0.5 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Creating...
            </>
          ) : (
            'Create'
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={creating}
          className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

const HomePage: React.FC = () => {
  const { client } = useTributary()
  const { syncStatus, globalSyncStatus, setFocusedLibrary, requestSync, isSyncingAny } = useSyncStatus()
  const [libraries, setLibraries] = useState<LibraryInfo[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [showImport, setShowImport] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [importKey, setImportKey] = useState<string | undefined>(undefined)
  const [searchParams, setSearchParams] = useSearchParams()
  const [syncSpinning, setSyncSpinning] = useState(false)
  const syncSpinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSync = useCallback(() => {
    requestSync()
    setSyncSpinning(true)
    // Guarantee at least one full rotation (1s) even if sync completes instantly
    if (syncSpinTimer.current) clearTimeout(syncSpinTimer.current)
    syncSpinTimer.current = setTimeout(() => setSyncSpinning(false), 1000)
  }, [requestSync])

  // Clear timer on unmount
  useEffect(() => {
    return () => { if (syncSpinTimer.current) clearTimeout(syncSpinTimer.current) }
  }, [])

  const showSyncSpin = syncSpinning || isSyncingAny

  // Open create/import card if ?create or ?import is in the URL (e.g. from mobile nav or /import/write/:writeKey redirect)
  useEffect(() => {
    if (searchParams.has('create')) {
      setShowCreate(true)
      setShowImport(false)
      setSearchParams({}, { replace: true })
    } else if (searchParams.has('import')) {
      setShowImport(true)
      setShowCreate(false)
      const writeKey = searchParams.get('writeKey') ?? undefined
      if (writeKey) {
        setImportKey(writeKey)
      }
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // Clear focused library so all libraries sync on the home page
  useEffect(() => {
    setFocusedLibrary(null)
  }, [setFocusedLibrary])

  useEffect(() => {
    const fetchData = async () => {
      if (client) {
        try {
          const collections = await getHomeCollections(client)
          if (collections !== null) {
            setLibraries(collections)
          } else {
            const libraryList = await getLibraries(client)
            setLibraries(libraryList)
          }
        } catch (error) {
          logError('Failed to fetch home data:', error)
        } finally {
          setLoading(false)
        }
      } else {
        setLoading(false)
      }
    }

    fetchData()
  }, [client, syncStatus])

  const handleStartCreate = useCallback(() => {
    setShowCreate(true)
    setShowImport(false)
    setImportKey(undefined)
  }, [])

  const handleCancelCreate = useCallback(() => {
    setShowCreate(false)
  }, [])

  const handleCreated = useCallback(() => {
    setShowCreate(false)
  }, [])

  const handleStartImport = useCallback(() => {
    setShowImport(true)
    setShowCreate(false)
  }, [])

  const handleCancelImport = useCallback(() => {
    setShowImport(false)
    setImportKey(undefined)
  }, [])

  const handleImported = useCallback(() => {
    setShowImport(false)
    setImportKey(undefined)
  }, [])

  const hasItems = libraries !== null && libraries.length > 0

  return (
    <div className="min-h-screen bg-gray-50 py-16">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {loading ? (
          <div className="text-center py-8">
            <p className="text-gray-500">Loading your libraries...</p>
          </div>
        ) : hasItems || showImport || showCreate ? (
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-8 py-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Your Libraries</h3>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSync}
                  disabled={showSyncSpin}
                  className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Sync all libraries"
                  title="Sync all libraries"
                >
                  <ArrowPathIcon className={`h-6 w-6 ${showSyncSpin ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={handleStartCreate}
                  disabled={showCreate}
                  className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Create new library"
                >
                  <PlusIcon className="h-6 w-6" />
                </button>
                <button
                  onClick={handleStartImport}
                  disabled={showImport}
                  className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-green-100 text-green-600 hover:bg-green-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Import existing library"
                >
                  <ArrowDownOnSquareIcon className="h-6 w-6" />
                </button>
              </div>
            </div>
            <div className="px-8 py-6 bg-gray-50">
              <div className="space-y-3">
                {showCreate && (
                  <CreateCard
                    onCancel={handleCancelCreate}
                    onCreated={handleCreated}
                  />
                )}
                {showImport && (
                  <ImportCard
                    onCancel={handleCancelImport}
                    onImported={handleImported}
                    initialKey={importKey}
                  />
                )}
                {(() => {
                  // Pre-compute slugs and detect collisions so we can prefer /n/ routes
                  const slugCounts = new Map<string, number>()
                  const libraryDisplayNames = (libraries ?? []).map((library) => {
                    const displayName = library.libraryTitle || 'Notes'
                    const slug = titleToSlug(displayName)
                    slugCounts.set(slug, (slugCounts.get(slug) ?? 0) + 1)
                    return { library, displayName, slug }
                  })

                  return libraryDisplayNames.map(({ library, displayName, slug }) => {
                    const libStatus = syncStatus[library.libraryId]
                    const displayIdShort = `pk/${library.libraryId.substring(0, 10)}...`
                    const displayIdFull = `pk/${library.libraryId.substring(0, 16)}...`
                    const isSyncing = libStatus != null && !libStatus.synced
                    const hasSynced = libStatus?.lastSyncedAt != null

                    // Use named route when the slug is unique, otherwise fall back to pk route
                    const hasUniqueSlug = slug.length > 0 && (slugCounts.get(slug) ?? 0) === 1
                    const libraryPath = hasUniqueSlug ? `/n/${slug}/` : `/pk/${library.libraryId}/`
                    const settingsPath = hasUniqueSlug ? `/n/${slug}/&library` : `/pk/${library.libraryId}/&library`

                    const lastEdited = library.lastEdited
                    const lastEditedText = isSyncing
                      ? null // progress indicator replaces this
                      : !hasSynced && !lastEdited
                        ? 'Awaiting sync'
                        : lastEdited
                          ? new Date(lastEdited).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })
                          : 'No edits yet'

                    return (
                      <Link
                        key={library.libraryId}
                        to={libraryPath}
                        className="flex items-center p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all duration-200 group"
                      >
                        <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-lg bg-purple-100 text-purple-600 group-hover:bg-purple-200">
                          <DocumentTextIcon className="h-5 w-5" />
                        </div>
                        <div className="ml-4 flex-1 min-w-0">
                          <h4 className="text-base font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                            {displayName}
                          </h4>
                          <div className="flex items-center gap-2 overflow-hidden">
                            <span className="text-xs text-gray-400 font-mono truncate flex-shrink">
                              <span className="sm:hidden">{displayIdShort}</span>
                              <span className="hidden sm:inline">{displayIdFull}</span>
                            </span>
                            <span className="text-gray-300 hidden sm:inline">·</span>
                            {isSyncing ? (
                              <>
                                <span className="text-xs text-blue-600 font-medium whitespace-nowrap sm:hidden">
                                  {libStatus.currentIndex}/{libStatus.finalIndex}
                                </span>
                                <span className="text-xs text-blue-600 font-medium whitespace-nowrap hidden sm:inline">
                                  Syncing {libStatus.currentIndex}/{libStatus.finalIndex}
                                </span>
                              </>
                            ) : (
                              <p className="text-sm text-gray-500 whitespace-nowrap hidden sm:block">{lastEditedText}</p>
                            )}
                          </div>
                        </div>
                        <Link
                          to={settingsPath}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-shrink-0 ml-2 inline-flex items-center justify-center h-8 w-8 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          aria-label="Library settings"
                          title="Library settings"
                        >
                          <Cog6ToothIcon className="h-4 w-4" />
                        </Link>
                        <div className="flex-shrink-0 hidden md:block">
                          <svg className="h-5 w-5 text-gray-400 group-hover:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </Link>
                    )
                  })
                })()}
              </div>
            </div>
          </div>
        ) : globalSyncStatus.isSyncing ? (
          // Sync still in progress — don't show "No libraries" until we know for sure
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-8 py-16 text-center">
              <h3 className="text-2xl font-semibold text-gray-900">Syncing your libraries</h3>
              <p className="mt-2 text-gray-600">
                Downloading and indexing your encrypted data...
              </p>
              {globalSyncStatus.finalIndex > 0 && (
                <p className="mt-4 text-sm text-blue-600 font-medium">
                  {globalSyncStatus.currentIndex} / {globalSyncStatus.finalIndex}
                </p>
              )}
              <div className="mt-6 inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          </div>
        ) : (
          // Sync complete and genuinely no libraries — show empty state
          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="px-8 py-16 text-center">
              <h3 className="text-2xl font-semibold text-gray-900">No libraries yet</h3>
              <p className="mt-2 text-gray-600">
                Create a new encrypted library or import an existing one to begin managing your secure notes.
              </p>
              <div className="mt-8 flex justify-center gap-4">
                <button
                  onClick={handleStartCreate}
                  className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                >
                  <PlusIcon className="h-5 w-5 mr-2" />
                  Create New Library
                </button>
                <button
                  onClick={handleStartImport}
                  className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-green-700 bg-green-100 hover:bg-green-200 transition-colors"
                >
                  <ArrowDownOnSquareIcon className="h-5 w-5 mr-2" />
                  Import Existing Library
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default HomePage
