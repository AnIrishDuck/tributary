import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { saveNote } from 'scribe-react-note/src/actions/saveNote'
import { saveImage } from 'scribe-react-img/src/actions/saveImage'
import * as scribeData from 'scribe-data'

describe('SlugNoteListPage', () => {
  // Helper to create a collection and index it
  async function createIndexedCollection(
    stream: any,
    title: string,
    parentUuid: string
  ) {
    const col = await scribeData.createCollection(stream, {
      title,
      parent_collection_uuid: parentUuid,
      inserter: 'test-user'
    })
    await stream.sync(1000)
    await scribeData.indexAll(stream.local())
    return col
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render collection contents when slug resolves to a collection', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Get the library root
    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    // Create a collection
    const col = await createIndexedCollection(stream, 'My Recipes', library!.collection_uuid)

    // Create a note in that collection
    await saveNote(stream, '# Pasta\n\nDelicious pasta recipe.', 'web-ui', undefined, col.collection_uuid)

    // Navigate to the collection slug
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/my-recipes`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show the collection view with its name (appears in breadcrumbs + h1)
    await waitFor(() => {
      expect(screen.getAllByText('My Recipes').length).toBeGreaterThanOrEqual(1)
    }, { timeout: 5000 })

    // Should show the note inside the collection
    expect(screen.getByText('Pasta')).toBeInTheDocument()

    // Should show the FAB speed-dial menu (which includes Add Collection)
    await waitFor(() => {
      expect(screen.getByLabelText('Open menu')).toBeInTheDocument()
    })
  })

  it('should render image blocks with photo icon distinguishing them from notes', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    const col = await createIndexedCollection(stream, 'My Photos', library!.collection_uuid)

    // Create a markdown note
    await saveNote(stream, '# My Recipe\n\nDelicious food.', 'web-ui', undefined, col.collection_uuid)

    // Create an image block in the same collection
    const fileData = new Uint8Array([137, 80, 78, 71])
    await saveImage(stream, {
      fileData,
      contentType: 'image/png',
      fileName: 'sunset.png',
      slug: 'sunset',
      width: 800,
      height: 600,
      collectionId: col.collection_uuid,
    })

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/my-photos`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for collection view to load
    await waitFor(() => {
      expect(screen.getAllByText('My Photos').length).toBeGreaterThanOrEqual(1)
    }, { timeout: 5000 })

    // Both items should appear
    expect(screen.getByText('My Recipe')).toBeInTheDocument()
    expect(screen.getByText('sunset.png')).toBeInTheDocument()

    // The note slug badge should have blue styling, and image slug badge should have green styling
    const slugBadges = screen.getAllByText(/^(my-recipe|sunset)$/)
    expect(slugBadges.length).toBe(2)

    const sunsetBadge = screen.getByText('sunset')
    expect(sunsetBadge.className).toContain('green')

    const recipeBadge = screen.getByText('my-recipe')
    expect(recipeBadge.className).toContain('blue')
  })

  it('should show collection title as heading and slugs in breadcrumbs', async () => {
    const libraryName = 'Cooking Notes'
    const { client, stream, prefix } = await createTestClientWithStream(libraryName)
    const base64Part = prefix.split('/')[1]

    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    // Create a collection so breadcrumbs appear
    await createIndexedCollection(stream, 'Desserts', library!.collection_uuid)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/desserts`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for page to load — heading shows collection title
    await waitFor(() => {
      expect(screen.getByText('Desserts')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Breadcrumbs show slugs, and the root / links to library root
    expect(screen.getByText('desserts')).toBeInTheDocument()
    expect(screen.getByText('/')).toBeInTheDocument()
  })
})
