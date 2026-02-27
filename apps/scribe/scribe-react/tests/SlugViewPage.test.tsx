import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestTributaryClient } from '../src/context/tributaryContext'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { saveNote } from '../src/actions/saveNote'
import * as scribeData from 'scribe-data'

describe('SlugViewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render error state when parameters are missing', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/pk/test-prefix/test-slug']
    })

    const { client } = createTestTributaryClient()

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show error state for missing parameters
    await waitFor(() => {
      expect(screen.getByText(/Failed to load note/)).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('should resolve note when slug matches both a note and a collection (note takes priority)', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    // Helper to create a collection and index it
    const col = await scribeData.createCollection(stream, {
      title: 'Recipes',
      parent_collection_uuid: library!.collection_uuid,
      inserter: 'test-user'
    })
    await stream.sync(1000)
    await scribeData.indexAll(stream.local())

    // Create a note with the same slug "recipes"
    await saveNote(stream, '# Recipes\n\nA note about recipes.')

    // Navigate to the shared slug
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/recipes`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // In hierarchical routing, notes take priority over collections at the same scope
    // Should show the note view with Edit FAB
    await waitFor(() => {
      expect(screen.getByLabelText('Edit')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Should show the note content
    expect(screen.getByText(/A note about recipes/)).toBeInTheDocument()
  })
})
