import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { routes } from '../src/route'
import { createNote } from 'scribe-data/src/note'
import { indexSlugs, indexAll } from 'scribe-data/src/indexing'
import { saveDraft, getDraftSummariesForCollection } from 'scribe-react-note/src/drafts/draftStorage'
import { titleToSlug } from 'scribe-data/src/indexing'
import * as scribeData from 'scribe-data'

describe('Drafts with named routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('should find drafts saved on a pk route when viewing via a named route', async () => {
    // 1. Create a library and a note via pk route
    const { client, stream, prefix } = await createTestClientWithStream('My Recipes')
    const base64Part = prefix.split('/')[1]

    const block = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Chocolate Cake\n\nDelicious recipe.',
      inserter: 'test'
    })
    await stream.sync(1000)
    const localDb = stream.local()
    await indexSlugs(localDb)

    // 2. Save a draft as if the user was editing on a pk route
    //    (draft uses the base64 prefix, not the route paradigm)
    saveDraft({
      draftId: block.block_uuid,
      blockUuid: block.block_uuid,
      collectionId: null,
      prefix: base64Part,
      body: '# Chocolate Cake\n\nUpdated draft content.',
      updatedAt: new Date().toISOString(),
    })

    // 3. Navigate via the named route
    const librarySlug = titleToSlug('My Recipes')
    const router = createMemoryRouter(routes, {
      initialEntries: [`/n/${librarySlug}/`],
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // 4. Wait for the named route to resolve and the note list to render.
    //    Notes with drafts get an amber border and a draft indicator.
    await waitFor(() => {
      expect(screen.getByText('Chocolate Cake')).toBeInTheDocument()
    }, { timeout: 5000 })

    // The note should show a draft indicator (pencil icon / amber styling)
    // because getDraftSummariesForCollection uses the same prefix regardless of paradigm
    const drafts = getDraftSummariesForCollection(base64Part, null)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].draftId).toBe(block.block_uuid)
  })

  it('should find new-note drafts in a collection when accessed via named route', async () => {
    const { client, stream, prefix } = await createTestClientWithStream('Cookbook')
    const base64Part = prefix.split('/')[1]
    const localDb = stream.local()

    // Create a collection
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    await scribeData.createCollection(stream, {
      title: 'Desserts',
      parent_collection_uuid: library!.collection_uuid,
      inserter: 'test'
    })
    await stream.sync(1000)
    await indexAll(localDb)

    // Look up the collection UUID
    const collections = await scribeData.getChildCollections(localDb, library!.collection_uuid)
    const desserts = collections.find(c => c.title === 'Desserts')
    expect(desserts).toBeDefined()

    // Save a new-note draft in that collection (as if created on a pk route)
    const draftId = 'draft-new-note-123'
    saveDraft({
      draftId,
      blockUuid: null,
      collectionId: desserts!.collection_uuid,
      prefix: base64Part,
      body: '# Tiramisu\n\nA classic Italian dessert.',
      updatedAt: new Date().toISOString(),
    })

    // Navigate via named route to the collection
    const librarySlug = titleToSlug('Cookbook')
    const router = createMemoryRouter(routes, {
      initialEntries: [`/n/${librarySlug}/desserts`],
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // The draft should appear in the collection listing
    await waitFor(() => {
      expect(screen.getByText('Tiramisu')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Verify the draft is retrievable with the same prefix
    const collectionDrafts = getDraftSummariesForCollection(base64Part, desserts!.collection_uuid)
    expect(collectionDrafts).toHaveLength(1)
    expect(collectionDrafts[0].draftId).toBe(draftId)
  })

  it('should resume a new-note draft via +draft route on named route', async () => {
    const { client, stream, prefix } = await createTestClientWithStream('Journal')
    const base64Part = prefix.split('/')[1]

    await stream.sync(1000)

    // Save a new-note draft at the library root
    const draftId = 'draft-resume-456'
    saveDraft({
      draftId,
      blockUuid: null,
      collectionId: null,
      prefix: base64Part,
      body: '# My Thoughts\n\nSome draft content.',
      updatedAt: new Date().toISOString(),
    })

    // Navigate to the +draft route via named route
    const librarySlug = titleToSlug('Journal')
    const router = createMemoryRouter(routes, {
      initialEntries: [`/n/${librarySlug}/+draft/${draftId}`],
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // The editor should load with the draft content
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Journal' })).toBeInTheDocument()
    }, { timeout: 5000 })

    // The editor should be in "Add Note" mode (new note from draft)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add Note' })).toBeInTheDocument()
    }, { timeout: 3000 })

    // The editor should contain the draft body
    await waitFor(() => {
      const editor = screen.getByRole('textbox')
      expect(editor.textContent).toContain('My Thoughts')
    }, { timeout: 3000 })
  })
})
