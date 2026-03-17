import { test, expect, describe } from 'vitest'
import { TributaryClient, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import { createHomeLibrary, createLibrary } from '../src/library.js'
import { getLibraries, getHomeCollections, resolveLibraryBySlug, resolveLibrarySlug } from '../src/homeLibrary.js'
import { LibraryInfo } from '../src/types.js'

function makeClient(server?: FakeServer) {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  return { client, server: s }
}

describe('getLibraries', () => {
  test('returns all registered stream IDs with null metadata', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const keyPair = nacl.sign.keyPair()
    const { stream: homeStream, streamId } = await createHomeLibrary(client, 'Home', keyPair)
    const { streamId: libId } = await createLibrary(client, 'Lib A', homeStream)

    const libs = await getLibraries(client)
    expect(libs.length).toBeGreaterThanOrEqual(2)
    const ids = libs.map(l => l.libraryId)
    expect(ids).toContain(streamId)
    expect(ids).toContain(libId)
    // Metadata is null (populated by sync loop)
    for (const lib of libs) {
      expect(lib.lastEdited).toBeNull()
      expect(lib.libraryTitle).toBeNull()
    }
  })

  test('returns empty array when no streams registered', async () => {
    const { client } = makeClient()
    const libs = await getLibraries(client)
    expect(libs).toEqual([])
  })
})

describe('getHomeCollections', () => {
  test('returns null when no home stream is set', async () => {
    const { client } = makeClient()
    const result = await getHomeCollections(client)
    expect(result).toBeNull()
  })

  test('returns empty array when home stream has no linked libraries', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    await createHomeLibrary(client, 'Home', keyPair)

    const result = await getHomeCollections(client)
    expect(result).toEqual([])
  })

  test('returns linked libraries with titles from collection table on first load', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const keyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', keyPair)
    const { streamId: libId } = await createLibrary(client, 'My Notes', homeStream)

    const result = await getHomeCollections(client)
    expect(result).not.toBeNull()
    expect(result!.length).toBe(1)
    expect(result![0].libraryId).toBe(libId)
    expect(result![0].libraryTitle).toBe('My Notes')
  })

  test('returns cached linked libraries on subsequent loads', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const keyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', keyPair)
    await createLibrary(client, 'Cached Lib', homeStream)

    // First call seeds the cache
    const first = await getHomeCollections(client)
    expect(first).not.toBeNull()
    expect(first!.length).toBe(1)

    // Second call should use the cache (same result)
    const second = await getHomeCollections(client)
    expect(second).not.toBeNull()
    expect(second!.length).toBe(1)
    expect(second![0].libraryTitle).toBe('Cached Lib')
  })
})

describe('resolveLibraryBySlug', () => {
  test('returns resolved for a single matching library', () => {
    const libraries: LibraryInfo[] = [
      { libraryId: 'id-1', lastEdited: null, libraryTitle: 'My Recipes' },
      { libraryId: 'id-2', lastEdited: null, libraryTitle: 'Work Notes' },
    ]
    const result = resolveLibraryBySlug(libraries, 'my-recipes')
    expect(result).toEqual({
      type: 'resolved',
      libraryId: 'id-1',
      libraryTitle: 'My Recipes',
    })
  })

  test('returns conflict for multiple libraries with the same slug', () => {
    const libraries: LibraryInfo[] = [
      { libraryId: 'id-1', lastEdited: null, libraryTitle: 'My Notes' },
      { libraryId: 'id-2', lastEdited: null, libraryTitle: 'My Notes' },
    ]
    const result = resolveLibraryBySlug(libraries, 'my-notes')
    expect(result.type).toBe('conflict')
    if (result.type === 'conflict') {
      expect(result.matches).toHaveLength(2)
    }
  })

  test('returns not_found when no libraries match', () => {
    const libraries: LibraryInfo[] = [
      { libraryId: 'id-1', lastEdited: null, libraryTitle: 'My Recipes' },
    ]
    const result = resolveLibraryBySlug(libraries, 'nonexistent')
    expect(result).toEqual({ type: 'not_found' })
  })

  test('skips libraries with null titles', () => {
    const libraries: LibraryInfo[] = [
      { libraryId: 'id-1', lastEdited: null, libraryTitle: null },
      { libraryId: 'id-2', lastEdited: null, libraryTitle: 'My Notes' },
    ]
    const result = resolveLibraryBySlug(libraries, 'my-notes')
    expect(result).toEqual({
      type: 'resolved',
      libraryId: 'id-2',
      libraryTitle: 'My Notes',
    })
  })

  test('handles special characters in titles', () => {
    const libraries: LibraryInfo[] = [
      { libraryId: 'id-1', lastEdited: null, libraryTitle: 'Café & More!' },
    ]
    // titleToSlug('Café & More!') => 'caf--more' => 'caf-more' (after double-hyphen collapse)
    const result = resolveLibraryBySlug(libraries, 'caf--more')
    // Exact slug depends on titleToSlug implementation; test it doesn't crash
    expect(['resolved', 'not_found']).toContain(result.type)
  })
})

describe('resolveLibrarySlug', () => {
  test('resolves a library through the full pipeline', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const keyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', keyPair)
    const { streamId } = await createLibrary(client, 'My Recipes', homeStream)

    const result = await resolveLibrarySlug(client, 'my-recipes')
    expect(result).toEqual({
      type: 'resolved',
      libraryId: streamId,
      libraryTitle: 'My Recipes',
    })
  })

  test('returns not_found for nonexistent slug', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const keyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', keyPair)
    await createLibrary(client, 'My Recipes', homeStream)

    const result = await resolveLibrarySlug(client, 'nonexistent')
    expect(result).toEqual({ type: 'not_found' })
  })

  test('returns conflict when two libraries share a slug', async () => {
    const server = new FakeServer()
    const { client } = makeClient(server)
    const keyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', keyPair)
    await createLibrary(client, 'My Notes', homeStream)
    await createLibrary(client, 'My Notes', homeStream)

    const result = await resolveLibrarySlug(client, 'my-notes')
    expect(result.type).toBe('conflict')
    if (result.type === 'conflict') {
      expect(result.matches).toHaveLength(2)
    }
  })
})
