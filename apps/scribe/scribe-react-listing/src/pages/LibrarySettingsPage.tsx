import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router'
import { ClipboardDocumentIcon, BookmarkIcon, QuestionMarkCircleIcon, CheckIcon, PlusIcon, TrashIcon, ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { useSyncStatus } from 'scribe-react-common/src/context/syncStatusContext'
import { useRouteContext } from 'scribe-react-common/src/context/routeContext'
import { getLibraryDisplayName, getLibraryStats, getLibraryPlugins, setLibraryPlugins, LibraryStats, StreamStorageEstimate, PluginEntry } from 'scribe-data'
import { AddPluginModal } from '../components/AddPluginModal'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

interface LibrarySettingsPageProps {
  prefix: string
}

const LibrarySettingsPage: React.FC<LibrarySettingsPageProps> = ({ prefix }) => {
  const { client } = useTributary()
  const { syncStatus, setFocusedLibrary } = useSyncStatus()
  const routeCtx = useRouteContext()
  const [libraryName, setLibraryName] = useState<string | null>(null)
  const [stats, setStats] = useState<LibraryStats | null>(null)
  const [storageEstimate, setStorageEstimate] = useState<StreamStorageEstimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const [bookmarkletCopied, setBookmarkletCopied] = useState(false)
  const [showMobileHelp, setShowMobileHelp] = useState(false)
  const [plugins, setPlugins] = useState<PluginEntry[]>([])
  const [showAddPlugin, setShowAddPlugin] = useState(false)
  const [pluginSaving, setPluginSaving] = useState(false)

  useEffect(() => {
    if (prefix) {
      setFocusedLibrary(prefix)
      return () => setFocusedLibrary(null)
    }
  }, [prefix, setFocusedLibrary])

  const librarySyncStatusDep = prefix ? syncStatus[prefix] : undefined

  useEffect(() => {
    const load = async () => {
      if (!client || !prefix) {
        setLoading(false)
        return
      }

      try {
        const localDb = await client.getLocal('scribe', prefix)
        if (!localDb) {
          setLoading(false)
          return
        }

        const stream = await client.get('scribe', prefix)

        const [name, libraryStats] = await Promise.all([
          getLibraryDisplayName(localDb),
          getLibraryStats(localDb),
        ])

        setLibraryName(name)
        setStats(libraryStats)

        if (stream) {
          const [storage, libraryPlugins] = await Promise.all([
            stream.estimateStorage(),
            getLibraryPlugins(stream),
          ])
          setStorageEstimate(storage)
          setPlugins(libraryPlugins)
        }
      } catch (err) {
        console.error('Failed to load library settings:', err)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [client, prefix, librarySyncStatusDep])

  const savePlugins = useCallback(async (newPlugins: Array<{ plugin_url: string; config_json?: string }>) => {
    if (!client || !prefix) return
    setPluginSaving(true)
    try {
      const stream = await client.get('scribe', prefix)
      if (!stream) return
      await setLibraryPlugins(stream, newPlugins)
      await stream.sync(1000)
      const updated = await getLibraryPlugins(stream)
      setPlugins(updated)
    } catch (err) {
      console.error('Failed to save plugins:', err)
    } finally {
      setPluginSaving(false)
    }
  }, [client, prefix])

  const handleAddPlugin = useCallback(async (url: string, configJson: string) => {
    const newPlugins = [
      ...plugins.map(p => ({ plugin_url: p.plugin_url, config_json: p.config_json })),
      { plugin_url: url, config_json: configJson }
    ]
    await savePlugins(newPlugins)
  }, [plugins, savePlugins])

  const handleRemovePlugin = useCallback(async (index: number) => {
    const newPlugins = plugins
      .filter((_, i) => i !== index)
      .map(p => ({ plugin_url: p.plugin_url, config_json: p.config_json }))
    await savePlugins(newPlugins)
  }, [plugins, savePlugins])

  const handleMovePlugin = useCallback(async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= plugins.length) return
    const reordered = [...plugins]
    const [moved] = reordered.splice(index, 1)
    reordered.splice(newIndex, 0, moved)
    await savePlugins(reordered.map(p => ({ plugin_url: p.plugin_url, config_json: p.config_json })))
  }, [plugins, savePlugins])

  const handleCopyShareLink = async () => {
    if (!client) return

    try {
      const writeKey = await client.getWriteKey(prefix)
      if (!writeKey) {
        console.error('No write key found for library')
        return
      }
      const url = `${window.location.origin}${window.location.pathname}#/?import&writeKey=${writeKey}`
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy share link:', err)
    }
  }

  const bookmarkletHref = useMemo(() => {
    const base = window.location.origin + window.location.pathname
    const notePath = routeCtx.buildPath('+note')
    // The bookmarklet composes markdown from the page title and URL, then opens
    // Scribe's +note route with the body pre-filled via a query parameter.
    const js = [
      `javascript:void(window.open(`,
      `'${base}#${notePath}?body='`,
      `+encodeURIComponent('# '+document.title+'\\n\\n['+document.title+']('+location.href+')\\n')`,
      `))`,
    ].join('')
    return js
  }, [routeCtx])

  const displayName = libraryName || 'Library'
  const librarySyncStatus = prefix ? syncStatus[prefix] : undefined
  const showSyncProgress = librarySyncStatus && !librarySyncStatus.synced

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-4">
        <div className="text-center">
          <div className="mx-auto w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-2"></div>
          <p className="text-sm text-gray-600">Loading settings...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sync Progress Banner */}
      {showSyncProgress && (
        <div className="sticky top-0 z-40 bg-blue-50 border-b border-blue-200 py-2">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2 text-sm">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <span className="text-blue-900 font-medium">
                Syncing: {librarySyncStatus.currentIndex}/{librarySyncStatus.finalIndex} blocks
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-4">
          <Link
            to="/"
            className="text-sm text-blue-600 hover:text-blue-800 transition-colors"
          >
            &larr; Home
          </Link>
        </div>

        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="px-8 py-6 border-b border-gray-100">
            <h1 className="text-xl font-semibold text-gray-900">{displayName}</h1>
            <p className="mt-1 text-sm text-gray-500 font-mono">pk/{prefix.substring(0, 16)}...</p>
          </div>

          {stats && (
            <div className="px-8 py-6 border-b border-gray-100">
              <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">Statistics</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-gray-50 rounded-xl">
                  <p className="text-2xl font-semibold text-gray-900">{stats.editCount}</p>
                  <p className="text-sm text-gray-500 mt-1">Edits</p>
                </div>
                <div className="text-center p-4 bg-gray-50 rounded-xl">
                  <p className="text-2xl font-semibold text-gray-900">{stats.noteCount}</p>
                  <p className="text-sm text-gray-500 mt-1">Notes</p>
                </div>
                <div className="text-center p-4 bg-gray-50 rounded-xl">
                  <p className="text-2xl font-semibold text-gray-900">{stats.collectionCount}</p>
                  <p className="text-sm text-gray-500 mt-1">Collections</p>
                </div>
                {storageEstimate && (
                  <div className="text-center p-4 bg-gray-50 rounded-xl">
                    <p className="text-2xl font-semibold text-gray-900">{formatBytes(storageEstimate.estimatedBytes)}</p>
                    <p className="text-sm text-gray-500 mt-1">Storage</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="px-8 py-6 border-b border-gray-100">
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">Sharing</h2>
            <p className="text-sm text-gray-600 mb-4">
              Share this link to give someone write access to this library.
            </p>
            <button
              onClick={handleCopyShareLink}
              className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            >
              <ClipboardDocumentIcon className="h-4 w-4 mr-2" />
              {copied ? 'Copied!' : 'Copy share link'}
            </button>
          </div>

          <div className="px-8 py-6 border-b border-gray-100">
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">Bookmarklet</h2>
            <div className="flex items-center gap-2">
              <a
                href={bookmarkletHref}
                onClick={(e) => e.preventDefault()}
                className="inline-flex items-center justify-center px-4 py-2 border border-blue-300 text-sm font-medium rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100 transition-colors cursor-grab"
              >
                <BookmarkIcon className="h-4 w-4 mr-2" />
                Save to {displayName}
              </a>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(bookmarkletHref)
                  setBookmarkletCopied(true)
                  setTimeout(() => setBookmarkletCopied(false), 2000)
                }}
                title="Copy bookmarklet"
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                {bookmarkletCopied
                  ? <CheckIcon className="h-5 w-5 text-green-500" />
                  : <ClipboardDocumentIcon className="h-5 w-5" />}
              </button>
              <button
                onClick={() => setShowMobileHelp(!showMobileHelp)}
                title="Setup instructions"
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <QuestionMarkCircleIcon className="h-5 w-5" />
              </button>
            </div>
            {showMobileHelp && (
              <ol className="mt-3 text-sm text-gray-600 list-decimal list-inside space-y-1">
                <li>Drag the link above to your bookmarks bar, or:</li>
                <li>Tap the copy button, then add a new bookmark and paste as the URL</li>
                <li>Click the bookmark on any page to save it as a note</li>
              </ol>
            )}
          </div>

          <div className="px-8 py-6">
            <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-4">Plugins</h2>
            {plugins.length === 0 ? (
              <p className="text-sm text-gray-500 mb-4">No plugins configured for this library.</p>
            ) : (
              <div className="space-y-2 mb-4">
                {plugins.map((plugin, index) => (
                  <div key={plugin.plugin_url} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 font-mono truncate">{plugin.plugin_url}</p>
                      {plugin.config_json !== '{}' && (
                        <p className="text-xs text-gray-500 font-mono truncate">{plugin.config_json}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleMovePlugin(index, 'up')}
                        disabled={index === 0 || pluginSaving}
                        title="Move up"
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                      >
                        <ChevronUpIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMovePlugin(index, 'down')}
                        disabled={index === plugins.length - 1 || pluginSaving}
                        title="Move down"
                        className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors"
                      >
                        <ChevronDownIcon className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRemovePlugin(index)}
                        disabled={pluginSaving}
                        title="Remove plugin"
                        className="p-1 text-red-400 hover:text-red-600 disabled:opacity-30 transition-colors"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowAddPlugin(true)}
              disabled={pluginSaving}
              className="inline-flex items-center justify-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg text-gray-700 bg-white hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <PlusIcon className="h-4 w-4 mr-2" />
              Add plugin
            </button>
          </div>

          <AddPluginModal
            isOpen={showAddPlugin}
            onClose={() => setShowAddPlugin(false)}
            onConfirm={handleAddPlugin}
            existingUrls={plugins.map(p => p.plugin_url)}
          />
        </div>
      </div>
    </div>
  )
}

export default LibrarySettingsPage
