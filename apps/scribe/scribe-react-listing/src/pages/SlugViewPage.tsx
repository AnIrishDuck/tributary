import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { useSyncStatus } from 'scribe-react-common/src/context/syncStatusContext'
import { Collection, CollectionSlug, NoteSlugRow } from 'scribe-data'
import SlugLoadingPage from './SlugLoadingPage'
import SlugErrorPage from './SlugErrorPage'
import NoteViewPage from 'scribe-react-note/src/pages/NoteViewPage'
import NoteListView from './SlugNoteListPage'
import SlugCollision from './SlugCollision'
import EditorPage from 'scribe-react-note/src/pages/EditorPage'
import HistoryPage from 'scribe-react-note/src/pages/HistoryPage'
import NewCollectionPage from './NewCollectionPage'
import MissingSlugPage from './MissingSlugPage'
import MissingParentPage from './MissingParentPage'
import LibrarySettingsPage from './LibrarySettingsPage'
import { getDraftForNote } from 'scribe-react-note/src/drafts/draftStorage'

interface BlockSlugInfo {
  block_uuid: string;
  slug: string;
  title: string;
}

interface AuthoritativeVersion {
  block_uuid: string;
  version_uuid: string;
  indexed_at: string;
}

type PageMode =
  | { type: 'loading' }
  | { type: 'schemaLoading' }
  | { type: 'schemaError' }
  | { type: 'error'; message: string }
  | { type: 'note'; content: string; title: string; slugPath: string; ancestors: Collection[]; libraryName: string; versionUuid: string; blockUuid: string }
  | { type: 'historicalNote'; content: string; title: string; slugPath: string; versionUuid: string; blockUuid: string; ancestors: Collection[]; libraryName: string }
  | { type: 'duplicateNotes'; notes: BlockSlugInfo[]; slugPath: string }
  | { type: 'collection'; collection: CollectionSlug; ancestors: Collection[]; childCollections: { collection: Collection; slug: string | null }[]; notes: NoteSlugRow[]; collidingSlugs: Set<string>; slugPath: string; libraryName: string }
  | { type: 'disambiguation'; notes: BlockSlugInfo[]; collections: CollectionSlug[]; slugPath: string }
  | { type: 'newNote'; collectionId?: string; parentSlugPath: string; initialTitle?: string; collectionLabel: string; ancestors: Collection[] }
  | { type: 'newCollection'; parentUuid?: string; parentSlugPath: string; ancestors: Collection[]; libraryName: string; initialTitle?: string }
  | { type: 'editNote'; editBlockUuid: string; noteSlugPath: string; collectionLabel: string }
  | { type: 'resumeDraft'; draftId: string; collectionId?: string; parentSlugPath: string; collectionLabel: string; ancestors: Collection[] }
  | { type: 'missingSlug'; slugPath: string }
  | { type: 'missingParent'; slugPath: string; resolvedSegments: string[]; missingSegments: string[] }
  | { type: 'librarySettings' }
  | { type: 'history'; blockUuid: string; slugPath: string; ancestors: Collection[]; libraryName: string }

const SlugViewPage: React.FC = () => {
  const [mode, setMode] = useState<PageMode>({ type: 'loading' })
  const navigate = useNavigate()
  const { client } = useTributary()
  const { syncStatus, globalSyncStatus, setFocusedLibrary } = useSyncStatus()

  // Extract the library prefix and splat path from params
  const params = useParams()
  const prefix = params.prefix
  const splatPath = params['*'] || ''

  // Track whether this specific library has been synced at least once
  const librarySynced = prefix ? (syncStatus[prefix]?.synced ?? false) : false

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

      // --- Handle &library (library settings page) ---
      if (splatPath === '&library') {
        setMode({ type: 'librarySettings' })
        return
      }

      try {
        const streamId = prefix
        const stream = await client.get('scribe', streamId)

        if (!stream) {
          // Library not in local DB yet. If the sync loop hasn't finished
          // discovering all linked libraries, stay in loading state — the
          // effect will re-run once librarySynced or globalSyncStatus.synced
          // changes. Once the global sync has completed a full cycle (home
          // stream processed, linked libraries registered) and the library
          // still doesn't exist, surface the error.
          if (!librarySynced && !globalSyncStatus.synced) {
            setMode({ type: 'loading' })
            return
          }
          throw new Error('Failed to get library')
        }

        const localDb = stream.local()

        const {
          schemaReady,
          getAuthoritativeVersionByNoteUuid, getNoteByVersion,
          getLibrary, getLibraryDisplayName, getCollectionByUuid, getChildCollections,
          getCollectionAncestors, getNotesInCollectionWithSlugs, getCollidingSlugs, slugToTitle,
          resolveSlugPath, getSlugPath, getNoteSlugByUuid
        } = await import('scribe-data')

        // Check if the synced schema tables exist before attempting queries.
        // If the library is still syncing, the schema may not have arrived yet
        // — show a loading spinner. If it's fully synced and still missing,
        // that's an error.
        if (!await schemaReady(localDb)) {
          if (!librarySynced) {
            setMode({ type: 'schemaLoading' })
          } else {
            setMode({ type: 'schemaError' })
          }
          return
        }

        // Fetch library display name once for breadcrumbs
        const libraryName = await getLibraryDisplayName(localDb) || 'Library'

        // Parse the splat path into segments
        const segments = splatPath.split('/').filter(Boolean)

        if (segments.length === 0) {
          throw new Error('Not found')
        }

        const lastSegment = segments[segments.length - 1]

        // --- Handle +note (new note creation) ---
        if (lastSegment === '+note') {
          const parentSegments = segments.slice(0, -1)
          let collectionId: string | undefined = undefined
          let collectionLabel = libraryName
          const parentSlugPath = parentSegments.join('/')
          let noteAncestors: Collection[] = []

          if (parentSegments.length > 0) {
            const library = await getLibrary(localDb)
            if (!library) throw new Error('Library not found')
            const resolved = await resolveSlugPath(localDb, parentSegments, library.collection_uuid)
            if (!resolved || resolved.type !== 'collection') {
              throw new Error('Parent path does not resolve to a collection')
            }
            collectionId = resolved.entity.collection_uuid
            collectionLabel = resolved.entity.title || libraryName
            noteAncestors = await getCollectionAncestors(localDb, resolved.entity.collection_uuid)
          }

          setMode({ type: 'newNote', collectionId, parentSlugPath, collectionLabel, ancestors: noteAncestors })
          return
        }

        // --- Handle +draft/{draftId} (resume a new-note draft) ---
        if (segments.length >= 2 && segments[segments.length - 2] === '+draft') {
          const draftId = lastSegment
          const parentSegments = segments.slice(0, -2)
          let collectionId: string | undefined = undefined
          let collectionLabel = libraryName
          const parentSlugPath = parentSegments.join('/')
          let draftAncestors: Collection[] = []

          if (parentSegments.length > 0) {
            const library = await getLibrary(localDb)
            if (!library) throw new Error('Library not found')
            const resolved = await resolveSlugPath(localDb, parentSegments, library.collection_uuid)
            if (!resolved || resolved.type !== 'collection') {
              throw new Error('Parent path does not resolve to a collection')
            }
            collectionId = resolved.entity.collection_uuid
            collectionLabel = resolved.entity.title || libraryName
            draftAncestors = await getCollectionAncestors(localDb, resolved.entity.collection_uuid)
          }

          setMode({ type: 'resumeDraft', draftId, collectionId, parentSlugPath, collectionLabel, ancestors: draftAncestors })
          return
        }

        // --- Handle +collection (new collection creation) ---
        if (lastSegment === '+collection') {
          const parentSegments = segments.slice(0, -1)
          const parentSlugPath = parentSegments.join('/')

          const library = await getLibrary(localDb)
          if (!library) throw new Error('Library not found')

          let parentUuid: string = library.collection_uuid
          let ancestors: Collection[] = []

          if (parentSegments.length > 0) {
            const resolved = await resolveSlugPath(localDb, parentSegments, library.collection_uuid)
            if (!resolved || resolved.type !== 'collection') {
              throw new Error('Parent path does not resolve to a collection')
            }
            parentUuid = resolved.entity.collection_uuid
            ancestors = await getCollectionAncestors(localDb, parentUuid)
          }

          setMode({ type: 'newCollection', parentUuid, parentSlugPath, ancestors, libraryName })
          return
        }

        // --- Handle slug+note suffix (create note at missing slug) ---
        if (lastSegment.endsWith('+note') && lastSegment !== '+note') {
          const slugName = lastSegment.slice(0, -'+note'.length)
          const parentSegments = segments.slice(0, -1)

          const library = await getLibrary(localDb)
          if (!library) throw new Error('Library not found')

          // Resolve the parent path to get the collection id
          let collectionId: string | undefined = undefined
          let collectionLabel = libraryName
          let slugNoteAncestors: Collection[] = []
          if (parentSegments.length > 0) {
            const resolved = await resolveSlugPath(localDb, parentSegments, library.collection_uuid)
            if (!resolved || resolved.type !== 'collection') {
              throw new Error('Parent path does not resolve to a collection')
            }
            collectionId = resolved.entity.collection_uuid
            collectionLabel = resolved.entity.title || libraryName
            slugNoteAncestors = await getCollectionAncestors(localDb, resolved.entity.collection_uuid)
          }

          setMode({ type: 'newNote', collectionId, parentSlugPath: parentSegments.join('/'), initialTitle: slugToTitle(slugName), collectionLabel, ancestors: slugNoteAncestors })
          return
        }

        // --- Handle slug+collection suffix (create collection at missing slug) ---
        if (lastSegment.endsWith('+collection') && lastSegment !== '+collection') {
          const slugName = lastSegment.slice(0, -'+collection'.length)
          const parentSegments = segments.slice(0, -1)

          const library = await getLibrary(localDb)
          if (!library) throw new Error('Library not found')

          let parentUuid: string = library.collection_uuid
          let ancestors: Collection[] = []

          if (parentSegments.length > 0) {
            const resolved = await resolveSlugPath(localDb, parentSegments, library.collection_uuid)
            if (!resolved || resolved.type !== 'collection') {
              throw new Error('Parent path does not resolve to a collection')
            }
            parentUuid = resolved.entity.collection_uuid
            ancestors = await getCollectionAncestors(localDb, parentUuid)
          }

          setMode({ type: 'newCollection', parentUuid, parentSlugPath: parentSegments.join('/'), ancestors, libraryName, initialTitle: slugToTitle(slugName) })
          return
        }

        // --- Handle @versionUuid suffix (view historical version) ---
        if (lastSegment.includes('@')) {
          const atIndex = lastSegment.indexOf('@')
          const noteSlug = lastSegment.slice(0, atIndex)
          const versionUuid = lastSegment.slice(atIndex + 1)

          if (!noteSlug || !versionUuid) {
            throw new Error('Invalid version URL')
          }

          const resolveSegments = [...segments.slice(0, -1), noteSlug]

          const library = await getLibrary(localDb)
          if (!library) throw new Error('Library not found')

          const resolved = await resolveSlugPath(localDb, resolveSegments, library.collection_uuid)
          if (!resolved || resolved.type !== 'note') {
            throw new Error('Path does not resolve to a note')
          }

          const blockSlugInfo = resolved.entity as BlockSlugInfo
          const note = await getNoteByVersion(localDb, blockSlugInfo.block_uuid, versionUuid)
          if (!note) {
            throw new Error('Version not found')
          }

          // Get parent collection ancestors for breadcrumbs
          let noteAncestors: Collection[] = []
          const parentSegments = segments.slice(0, -1)
          if (parentSegments.length > 0) {
            const parentResolved = await resolveSlugPath(localDb, parentSegments, library.collection_uuid)
            if (parentResolved && parentResolved.type === 'collection') {
              noteAncestors = await getCollectionAncestors(localDb, parentResolved.entity.collection_uuid)
            }
          }

          const fullSlugPath = resolveSegments.join('/')
          setMode({
            type: 'historicalNote',
            content: note.body,
            title: blockSlugInfo.title || '',
            slugPath: fullSlugPath,
            versionUuid,
            blockUuid: blockSlugInfo.block_uuid,
            ancestors: noteAncestors,
            libraryName
          })
          return
        }

        // --- Handle &history suffix (view version history) ---
        if (lastSegment.endsWith('&history')) {
          const noteSlug = lastSegment.slice(0, -'&history'.length)
          if (!noteSlug) throw new Error('Invalid history path')

          const resolveSegments = [...segments.slice(0, -1), noteSlug]

          const library = await getLibrary(localDb)
          if (!library) throw new Error('Library not found')

          const resolved = await resolveSlugPath(localDb, resolveSegments, library.collection_uuid)
          if (!resolved || resolved.type !== 'note') {
            throw new Error('Path does not resolve to a note')
          }

          const blockSlugInfo = resolved.entity as BlockSlugInfo
          const fullSlugPath = resolveSegments.join('/')

          let noteAncestors: Collection[] = []
          const parentSegments = segments.slice(0, -1)
          if (parentSegments.length > 0) {
            const parentResolved = await resolveSlugPath(localDb, parentSegments, library.collection_uuid)
            if (parentResolved && parentResolved.type === 'collection') {
              noteAncestors = await getCollectionAncestors(localDb, parentResolved.entity.collection_uuid)
            }
          }

          setMode({ type: 'history', blockUuid: blockSlugInfo.block_uuid, slugPath: fullSlugPath, ancestors: noteAncestors, libraryName })
          return
        }

        // --- Handle &edit suffix (edit existing note) ---
        if (lastSegment.endsWith('&edit')) {
          const noteSlug = lastSegment.slice(0, -'&edit'.length)
          if (!noteSlug) throw new Error('Invalid edit path')

          const resolveSegments = [...segments.slice(0, -1), noteSlug]
          const parentSegments = segments.slice(0, -1)

          const library = await getLibrary(localDb)
          if (!library) throw new Error('Library not found')

          // Resolve parent collection label
          let collectionLabel = libraryName
          if (parentSegments.length > 0) {
            const parentResolved = await resolveSlugPath(localDb, parentSegments, library.collection_uuid)
            if (parentResolved && parentResolved.type === 'collection') {
              collectionLabel = parentResolved.entity.title || libraryName
            }
          }

          // Check if the noteSlug looks like a UUID (for disambiguation links)
          const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
          if (uuidPattern.test(noteSlug)) {
            // Direct UUID access for edit
            const noteSlugPath = resolveSegments.join('/')
            setMode({ type: 'editNote', editBlockUuid: noteSlug, noteSlugPath, collectionLabel })
            return
          }

          const resolved = await resolveSlugPath(localDb, resolveSegments, library.collection_uuid)
          if (!resolved || resolved.type !== 'note') {
            throw new Error('Path does not resolve to an editable note')
          }

          const noteSlugPath = resolveSegments.join('/')
          setMode({ type: 'editNote', editBlockUuid: resolved.entity.block_uuid, noteSlugPath, collectionLabel })
          return
        }

        // --- Standard slug resolution ---

        // Get library root for scoped resolution
        const library = await getLibrary(localDb)
        if (!library) {
          throw new Error('Library not found')
        }

        // Check if the last segment looks like a UUID (for disambiguation links)
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (uuidPattern.test(lastSegment)) {
          // Direct UUID access — load the note directly
          const blockSlugInfo = await getNoteSlugByUuid(localDb, lastSegment) as BlockSlugInfo | null
          if (!blockSlugInfo) {
            throw new Error('Note not found')
          }

          // Resolve parent collection label for auto-redirect
          let uuidParentLabel = libraryName
          const uuidParentSegments = segments.slice(0, -1)
          if (uuidParentSegments.length > 0) {
            const uuidParentResolved = await resolveSlugPath(localDb, uuidParentSegments, library.collection_uuid)
            if (uuidParentResolved && uuidParentResolved.type === 'collection') {
              uuidParentLabel = uuidParentResolved.entity.title || libraryName
            }
          }

          // Auto-redirect to edit page if the note has a local draft
          if (prefix && getDraftForNote(prefix, blockSlugInfo.block_uuid)) {
            const noteSlugPath = segments.join('/')
            setMode({ type: 'editNote', editBlockUuid: blockSlugInfo.block_uuid, noteSlugPath, collectionLabel: uuidParentLabel })
            return
          }

          const noteResult = await loadNoteContent(localDb, blockSlugInfo, getAuthoritativeVersionByNoteUuid, getNoteByVersion)
          const fullSlugPath = segments.join('/')

          // Get parent collection ancestors for breadcrumbs
          let noteAncestors: Collection[] = []
          const parentSegments = segments.slice(0, -1)
          if (parentSegments.length > 0) {
            const parentResolved = await resolveSlugPath(localDb, parentSegments, library.collection_uuid)
            if (parentResolved && parentResolved.type === 'collection') {
              noteAncestors = await getCollectionAncestors(localDb, parentResolved.entity.collection_uuid)
            }
          }

          setMode({ type: 'note', content: noteResult.body, title: blockSlugInfo.title || '', slugPath: fullSlugPath, ancestors: noteAncestors, libraryName, versionUuid: noteResult.version_uuid, blockUuid: noteResult.block_uuid })
          return
        }

        // Use hierarchical slug resolution
        const resolved = await resolveSlugPath(localDb, segments, library.collection_uuid)

        if (!resolved) {
          // Slug not found — determine if it's a missing slug (parent exists)
          // or missing parent (intermediate collections don't exist)
          const { resolveSlugPathPartial } = await import('scribe-data')
          const partial = await resolveSlugPathPartial(localDb, segments, library.collection_uuid)
          const fullSlugPath = segments.join('/')

          if (partial.parentExists) {
            setMode({ type: 'missingSlug', slugPath: fullSlugPath })
          } else {
            setMode({
              type: 'missingParent',
              slugPath: fullSlugPath,
              resolvedSegments: partial.resolvedSegments,
              missingSegments: partial.missingSegments
            })
          }
          return
        }

        const fullSlugPath = segments.join('/')

        if (resolved.type === 'collision') {
          setMode({
            type: 'disambiguation',
            notes: resolved.collisions?.notes || [],
            collections: resolved.collisions?.collections || [],
            slugPath: fullSlugPath
          })
          return
        }

        if (resolved.type === 'note') {
          const blockSlugInfo = resolved.entity as BlockSlugInfo

          // Resolve parent collection label for auto-redirect
          let resolvedParentLabel = libraryName
          const resolvedParentSegments = segments.slice(0, -1)
          if (resolvedParentSegments.length > 0) {
            const resolvedParentResolved = await resolveSlugPath(localDb, resolvedParentSegments, library.collection_uuid)
            if (resolvedParentResolved && resolvedParentResolved.type === 'collection') {
              resolvedParentLabel = resolvedParentResolved.entity.title || libraryName
            }
          }

          // Auto-redirect to edit page if the note has a local draft
          if (prefix && getDraftForNote(prefix, blockSlugInfo.block_uuid)) {
            const noteSlugPath = segments.join('/')
            setMode({ type: 'editNote', editBlockUuid: blockSlugInfo.block_uuid, noteSlugPath, collectionLabel: resolvedParentLabel })
            return
          }

          const noteResult = await loadNoteContent(localDb, blockSlugInfo, getAuthoritativeVersionByNoteUuid, getNoteByVersion)

          // Get parent collection ancestors for breadcrumbs
          let noteAncestors: Collection[] = []
          const parentSegments = segments.slice(0, -1)
          if (parentSegments.length > 0) {
            const parentResolved = await resolveSlugPath(localDb, parentSegments, library.collection_uuid)
            if (parentResolved && parentResolved.type === 'collection') {
              noteAncestors = await getCollectionAncestors(localDb, parentResolved.entity.collection_uuid)
            }
          }

          setMode({ type: 'note', content: noteResult.body, title: blockSlugInfo.title || '', slugPath: fullSlugPath, ancestors: noteAncestors, libraryName, versionUuid: noteResult.version_uuid, blockUuid: noteResult.block_uuid })
          return
        }

        if (resolved.type === 'collection') {
          const col = resolved.entity as CollectionSlug

          const collectionData = await loadCollectionData(
            localDb, col, getCollectionByUuid, getChildCollections,
            getCollectionAncestors, getNotesInCollectionWithSlugs, getCollidingSlugs,
            fullSlugPath
          )
          setMode({ type: 'collection', ...collectionData, slugPath: fullSlugPath, libraryName })
          return
        }
      } catch (err: any) {
        setMode({ type: 'error', message: 'Failed to load note: ' + (err.message || 'Unknown error') })
        console.error('Error loading content:', err)
      }
    }

    loadContent()
  }, [client, prefix, splatPath, librarySynced, globalSyncStatus.synced])

  if (mode.type === 'loading' || mode.type === 'schemaLoading') {
    const libStatus = prefix ? syncStatus[prefix] : undefined
    const syncProgress = libStatus ? { currentIndex: libStatus.currentIndex, finalIndex: libStatus.finalIndex } : null
    return <SlugLoadingPage syncProgress={syncProgress} />
  }

  if (mode.type === 'schemaError') {
    return <SlugErrorPage message="Library schema could not be loaded. The library data may be corrupt or incompatible." prefix={prefix} />
  }

  if (mode.type === 'error') {
    return <SlugErrorPage message={mode.message} prefix={prefix} />
  }

  if (mode.type === 'duplicateNotes') {
    return (
      <SlugCollision
        notes={mode.notes}
        collections={[]}
        slugPath={mode.slugPath}
        splatPath={splatPath}
        prefix={prefix || ''}
      />
    )
  }

  if (mode.type === 'disambiguation') {
    return (
      <SlugCollision
        notes={mode.notes}
        collections={mode.collections}
        slugPath={mode.slugPath}
        splatPath={splatPath}
        prefix={prefix || ''}
      />
    )
  }

  if (mode.type === 'collection') {
    return (
      <NoteListView
        collection={mode.collection}
        ancestors={mode.ancestors}
        collections={mode.childCollections}
        notes={mode.notes}
        collidingSlugs={mode.collidingSlugs}
        slugPath={mode.slugPath}
        prefix={prefix || ''}
        libraryName={mode.libraryName}
      />
    )
  }

  if (mode.type === 'newNote') {
    return (
      <EditorPage
        prefix={prefix || ''}
        collectionId={mode.collectionId}
        cancelPath={mode.parentSlugPath ? `/pk/${prefix}/${mode.parentSlugPath}` : `/pk/${prefix}/`}
        initialTitle={mode.initialTitle}
        collectionLabel={mode.collectionLabel}
        ancestors={mode.ancestors}
      />
    )
  }

  if (mode.type === 'resumeDraft') {
    return (
      <EditorPage
        prefix={prefix || ''}
        collectionId={mode.collectionId}
        draftId={mode.draftId}
        cancelPath={mode.parentSlugPath ? `/pk/${prefix}/${mode.parentSlugPath}` : `/pk/${prefix}/`}
        collectionLabel={mode.collectionLabel}
        ancestors={mode.ancestors}
      />
    )
  }

  if (mode.type === 'newCollection') {
    return (
      <NewCollectionPage
        prefix={prefix || ''}
        parentUuid={mode.parentUuid}
        ancestors={mode.ancestors}
        cancelPath={mode.parentSlugPath ? `/pk/${prefix}/${mode.parentSlugPath}` : `/pk/${prefix}/`}
        libraryName={mode.libraryName}
        initialTitle={mode.initialTitle}
      />
    )
  }

  if (mode.type === 'librarySettings') {
    return <LibrarySettingsPage prefix={prefix || ''} />
  }

  if (mode.type === 'missingSlug') {
    return (
      <MissingSlugPage
        prefix={prefix || ''}
        slugPath={mode.slugPath}
      />
    )
  }

  if (mode.type === 'missingParent') {
    return (
      <MissingParentPage
        prefix={prefix || ''}
        slugPath={mode.slugPath}
        resolvedSegments={mode.resolvedSegments}
        missingSegments={mode.missingSegments}
      />
    )
  }

  if (mode.type === 'history') {
    return (
      <HistoryPage
        prefix={prefix || ''}
        blockUuid={mode.blockUuid}
        slugPath={mode.slugPath}
        ancestors={mode.ancestors}
        libraryName={mode.libraryName}
      />
    )
  }

  if (mode.type === 'editNote') {
    return (
      <EditorPage
        prefix={prefix || ''}
        editBlockUuid={mode.editBlockUuid}
        cancelPath={`/pk/${prefix}/${mode.noteSlugPath}`}
        collectionLabel={mode.collectionLabel}
        noteSlugPath={mode.noteSlugPath}
      />
    )
  }

  if (mode.type === 'historicalNote') {
    return (
      <NoteViewPage
        content={mode.content}
        title={mode.title}
        slugPath={mode.slugPath}
        prefix={prefix || ''}
        splatPath={splatPath}
        ancestors={mode.ancestors}
        libraryName={mode.libraryName}
        versionUuid={mode.versionUuid}
        blockUuid={mode.blockUuid}
        readOnly
      />
    )
  }

  // Note view (default — mode.type === 'note')
  return (
    <NoteViewPage
      content={mode.content}
      title={mode.title}
      slugPath={mode.slugPath}
      prefix={prefix || ''}
      splatPath={splatPath}
      ancestors={mode.ancestors}
      libraryName={mode.libraryName}
      versionUuid={mode.versionUuid}
      blockUuid={mode.blockUuid}
    />
  )
}

// Helper: load note content by block slug info
async function loadNoteContent(
  localDb: any,
  blockSlugInfo: BlockSlugInfo,
  getAuthoritativeVersionByNoteUuid: (db: any, uuid: string) => Promise<any>,
  getNoteByVersion: (db: any, blockUuid: string, versionUuid: string) => Promise<any>
): Promise<{ body: string; version_uuid: string; block_uuid: string }> {
  const authoritativeVersion = await getAuthoritativeVersionByNoteUuid(localDb, blockSlugInfo.block_uuid) as AuthoritativeVersion | null

  if (!authoritativeVersion) {
    throw new Error('Note version not found')
  }

  const note = await getNoteByVersion(localDb, blockSlugInfo.block_uuid, authoritativeVersion.version_uuid)

  if (!note) {
    throw new Error('Note content not found')
  }

  return { body: note.body, version_uuid: authoritativeVersion.version_uuid, block_uuid: blockSlugInfo.block_uuid }
}

// Helper: load collection data for rendering
async function loadCollectionData(
  localDb: any,
  col: CollectionSlug,
  getCollectionByUuid: (db: any, uuid: string) => Promise<Collection | null>,
  getChildCollections: (db: any, parentUuid: string) => Promise<Collection[]>,
  getCollectionAncestors: (db: any, uuid: string) => Promise<Collection[]>,
  getNotesInCollectionWithSlugs: (db: any, collectionId: string | null) => Promise<NoteSlugRow[]>,
  getCollidingSlugs: (db: any, parentId: string) => Promise<Set<string>>,
  slugPath: string
) {
  const [ancestors, children, notes, collidingSlugs] = await Promise.all([
    getCollectionAncestors(localDb, col.collection_uuid),
    getChildCollections(localDb, col.collection_uuid),
    getNotesInCollectionWithSlugs(localDb, col.collection_uuid),
    getCollidingSlugs(localDb, col.collection_uuid)
  ])

  // Get slugs for child collections (use synced slug property directly)
  const childCollections = children.map(child => ({
    collection: child,
    slug: child.slug || null
  }))

  return { collection: col, ancestors, childCollections, notes, collidingSlugs }
}

export default SlugViewPage
