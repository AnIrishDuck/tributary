import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { saveNote } from '../src/actions/saveNote'
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

    // Should show "New Collection" button (icon-only on mobile, text visible on desktop)
    expect(screen.getByRole('button', { name: /New Collection/ })).toBeInTheDocument()
  })

  it('should show library name instead of "Library" in breadcrumbs', async () => {
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

    // Wait for page to load
    await waitFor(() => {
      expect(screen.getByText('Desserts')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Breadcrumbs should show the actual library name, not "Library"
    expect(screen.getByText(libraryName)).toBeInTheDocument()
    expect(screen.queryByText('Library')).not.toBeInTheDocument()
  })
})
