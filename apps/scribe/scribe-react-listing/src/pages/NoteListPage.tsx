import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { useSyncStatus } from 'scribe-react-common/src/context/syncStatusContext'
import { useRouteContext } from 'scribe-react-common/src/context/routeContext'
import { getNotesInCollectionWithSlugs, getCollidingSlugs, NoteSlugRow, getLibraryDisplayName, getLibrary, getChildCollections, Collection, schemaReady } from 'scribe-data'
import NoteListView from './SlugNoteListPage'

const NoteListPage: React.FC = () => {
  const routeCtx = useRouteContext()
  const prefix = routeCtx.prefix
  const { client } = useTributary()
  const { syncStatus, globalSyncStatus, setFocusedLibrary } = useSyncStatus()
  const [notes, setNotes] = useState<NoteSlugRow[]>([])
  const [collections, setCollections] = useState<{ collection: Collection; slug: string | null }[]>([])
  const [collidingSlugsSet, setCollidingSlugsSet] = useState<Set<string>>(new Set())
  const [libraryName, setLibraryName] = useState<string | null>(null)
  const [libraryUuid, setLibraryUuid] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Focus sync on this library while the page is mounted
  useEffect(() => {
    if (prefix) {
      setFocusedLibrary(prefix)
      return () => setFocusedLibrary(null)
    }
  }, [prefix, setFocusedLibrary])

  // Only re-render when this library's sync status changes
  const librarySyncStatusDep = prefix ? syncStatus[prefix] : undefined

  useEffect(() => {
    const loadNotes = async () => {
      if (!client || !prefix) {
        setError('Client or prefix not available')
        setLoading(false)
        return
      }

      try {
        // Get the local database for this library
        const localDb = await client.getLocal('scribe', prefix)
        if (!localDb) {
          // Library not in local DB yet. If sync hasn't finished discovering
          // all linked libraries, stay in loading state — the effect will
          // re-run when librarySyncStatusDep or globalSyncStatus.synced changes.
          const libStatus = syncStatus[prefix]
          if ((!libStatus || !libStatus.synced) && !globalSyncStatus.synced) {
            return
          }
          throw new Error('Could not get local database')
        }

        // Check if the synced schema tables exist before attempting queries.
        // The sync loop only marks a library as `synced` after running
        // localMigrations + indexAll, so if synced is true the local tables
        // (authoritative_version, indexed_block, etc.) are guaranteed to exist.
        if (!await schemaReady(localDb)) {
          const libStatus = syncStatus[prefix]
          if (!libStatus || !libStatus.synced) {
            // Still syncing — stay in loading state, effect will re-run
            return
          }
          throw new Error('Library schema could not be loaded. The library data may be corrupt or incompatible.')
        }

        // Get library root collection
        const library = await getLibrary(localDb)

        let loadedNotes: NoteSlugRow[]
        let loadedCollections: { collection: Collection; slug: string | null }[]
        let loadedCollisions: Set<string>

        if (library) {
          // Get child collections of library root
          const childCollections = await getChildCollections(localDb, library.collection_uuid)
          loadedCollections = childCollections.map(c => ({
            collection: c,
            slug: c.slug || null
          }))

          // Get root-level notes and colliding slugs
          const [noteList, collisions] = await Promise.all([
            getNotesInCollectionWithSlugs(localDb, null),
            getCollidingSlugs(localDb, library.collection_uuid)
          ])
          loadedNotes = noteList
          loadedCollisions = collisions
        } else {
          // No library root — all notes are root-level
          loadedNotes = await getNotesInCollectionWithSlugs(localDb, null)
          loadedCollections = []
          loadedCollisions = new Set()
        }

        const loadedName = await getLibraryDisplayName(localDb)

        setNotes(loadedNotes)
        setCollections(loadedCollections)
        setCollidingSlugsSet(loadedCollisions)
        setLibraryName(loadedName)
        setLibraryUuid(library?.collection_uuid ?? null)
        setError(null)
        setLoading(false)
      } catch (err) {
        console.error('Error loading notes:', err)
        const libStatus = syncStatus[prefix]
        if (!libStatus || !libStatus.synced) {
          // Still syncing — the error may be due to incomplete data.
          // Stay in loading state; the effect will re-run as sync progresses.
          return
        }
        setError(`Failed to load notes: ${(err as Error).message}`)
        setLoading(false)
      }
    }

    loadNotes()
  }, [client, prefix, librarySyncStatusDep, globalSyncStatus.synced])

  // Render the page shell with empty data so the header and layout appear
  // instantly. Override synced to false so NoteListView shows a loading
  // spinner instead of the "empty collection" state while we load.
  if (loading) {
    const librarySyncStatus = prefix ? syncStatus[prefix] : undefined
    return (
      <NoteListView
        collections={[]}
        notes={[]}
        prefix={prefix || ''}
        slugPath=""
        libraryName={libraryName}
        libraryUuid={libraryUuid}
        syncProgress={librarySyncStatus ? {
          currentIndex: librarySyncStatus.currentIndex,
          finalIndex: librarySyncStatus.finalIndex,
          synced: false
        } : { currentIndex: 0, finalIndex: 0, synced: false }}
      />
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-4">
        <div className="max-w-md mx-auto px-4">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-center">
            <svg className="mx-auto w-8 h-8 text-red-500 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-red-800 font-medium text-sm mb-1">Error</p>
            <p className="text-red-700 text-xs">{error}</p>
          </div>
        </div>
      </div>
    )
  }

  // Get sync status for this library
  const librarySyncStatus = prefix ? syncStatus[prefix] : undefined

  return (
    <NoteListView
      collections={collections}
      notes={notes}
      collidingSlugs={collidingSlugsSet}
      prefix={prefix || ''}
      slugPath=""
      libraryName={libraryName}
      libraryUuid={libraryUuid}
      syncProgress={librarySyncStatus ? {
        currentIndex: librarySyncStatus.currentIndex,
        finalIndex: librarySyncStatus.finalIndex,
        synced: librarySyncStatus.synced
      } : null}
    />
  )
}

export default NoteListPage
