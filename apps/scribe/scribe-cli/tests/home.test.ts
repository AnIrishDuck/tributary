import { describe, it, expect } from 'vitest'
import { syncHomeLibrary, getLibraryWriteKey, listLinkedLibraries } from '../src/home.js'
import { createTestClient, createTestHomeWithLibraries } from './test-utils.js'

describe('syncHomeLibrary', () => {
  it('should return null when no home stream is configured', async () => {
    const { client } = createTestClient()
    const result = await syncHomeLibrary(client)
    expect(result).toBeNull()
  })

  it('should return the home stream when configured', async () => {
    const { homeClient } = await createTestHomeWithLibraries([])
    const result = await syncHomeLibrary(homeClient)
    expect(result).not.toBeNull()
  })
})

describe('getLibraryWriteKey', () => {
  it('should return null when no home stream is configured', async () => {
    const { client } = createTestClient()
    const result = await getLibraryWriteKey(client, 'nonexistent-pk')
    expect(result).toBeNull()
  })

  it('should return null for a non-existent library pk', async () => {
    const { homeClient } = await createTestHomeWithLibraries(['Library A'])
    const result = await getLibraryWriteKey(homeClient, 'nonexistent-pk')
    expect(result).toBeNull()
  })

  it('should return the write key for a linked library', async () => {
    const { homeClient, libraries } = await createTestHomeWithLibraries(['Library A'])
    const lib = libraries[0]

    const writeKey = await getLibraryWriteKey(homeClient, lib.streamId)
    expect(writeKey).toBe(lib.writeKey)
  })

  it('should find the correct library when multiple are linked', async () => {
    const { homeClient, libraries } = await createTestHomeWithLibraries(['Alpha', 'Beta', 'Gamma'])

    for (const lib of libraries) {
      const writeKey = await getLibraryWriteKey(homeClient, lib.streamId)
      expect(writeKey).toBe(lib.writeKey)
    }
  })
})

describe('listLinkedLibraries', () => {
  it('should return null when no home stream is configured', async () => {
    const { client } = createTestClient()
    const result = await listLinkedLibraries(client)
    expect(result).toBeNull()
  })

  it('should return empty array when no libraries are linked', async () => {
    const { homeClient } = await createTestHomeWithLibraries([])
    const result = await listLinkedLibraries(homeClient)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(0)
  })

  it('should list all linked libraries', async () => {
    const { homeClient, libraries } = await createTestHomeWithLibraries(['Alpha', 'Beta'])
    const result = await listLinkedLibraries(homeClient)

    expect(result).not.toBeNull()
    expect(result).toHaveLength(2)

    const titles = result!.map(lib => lib.title).sort()
    expect(titles).toEqual(['Alpha', 'Beta'])

    // Each entry should have the stream ID and write key
    for (const lib of result!) {
      const expected = libraries.find(l => l.name === lib.title)!
      expect(lib.linked_stream_id).toBe(expected.streamId)
      expect(lib.linked_stream_key).toBe(expected.writeKey)
    }
  })
})
