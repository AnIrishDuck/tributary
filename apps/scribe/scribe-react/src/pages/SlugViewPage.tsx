import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { useSyncStatus } from '../context/syncStatusContext'
import { Collection, CollectionSlug, NoteSlugRow } from 'scribe-data'
import SlugLoadingPage from './SlugLoadingPage'
import SlugErrorPage from './SlugErrorPage'
import NoteViewPage from './NoteViewPage'
import NoteListView from './SlugNoteListPage'
import SlugCollision from './SlugCollision'

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

const SlugViewPage: React.FC = () => {
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

  if (mode.type === 'loading') {
    return <SlugLoadingPage />
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
        slugPath={mode.slugPath}
        prefix={prefix || ''}
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
    />
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

export default SlugViewPage
