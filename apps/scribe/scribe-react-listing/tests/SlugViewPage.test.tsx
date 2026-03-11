import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestTributaryClient } from 'scribe-react-common/src/context/tributaryContext'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { saveNote } from 'scribe-react-note/src/actions/saveNote'
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

  it('should show disambiguation page when slug matches both a note and a collection', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    // Create a collection with slug "recipes"
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

    // When a note and collection share a slug, the disambiguation page should appear
    await waitFor(() => {
      expect(screen.getByText(/Multiple items match/)).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should render a specific historical version via @versionUuid suffix', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Create a note with initial content
    const { block } = await saveNote(stream, '# Pasta\n\nOriginal recipe.')
    const firstVersionUuid = block.version_uuid

    // Create a second version with updated content
    await saveNote(stream, '# Pasta\n\nUpdated recipe.', 'web-ui', block.block_uuid)

    // Navigate to the first version using @versionUuid suffix
    const slug = block.slug
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}@${firstVersionUuid}`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show the original version content
    await waitFor(() => {
      expect(screen.getByText(/Original recipe/)).toBeInTheDocument()
    }, { timeout: 5000 })

    // Should show the historical version badge
    expect(screen.getByText('Viewing historical version')).toBeInTheDocument()

    // Should NOT show the Edit FAB (read-only mode)
    expect(screen.queryByLabelText('Edit')).toBeNull()
  })

  it('should render history page when navigating to slug&history', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Create a note with two versions
    const { block } = await saveNote(stream, '# Pasta\n\nVersion 1.')
    await saveNote(stream, '# Pasta\n\nVersion 2.', 'web-ui', block.block_uuid)

    const slug = block.slug
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}&history`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show the history page header
    await waitFor(() => {
      expect(screen.getByText('Version History')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Should show version entries with "current" badge for authoritative version
    await waitFor(() => {
      expect(screen.getByText('current')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should show error for invalid version UUID in @suffix', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Create a note
    const { block } = await saveNote(stream, '# Pasta\n\nA recipe.')
    const slug = block.slug

    // Navigate with a non-existent version UUID
    const fakeVersionUuid = '00000000-0000-0000-0000-000000000000'
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}@${fakeVersionUuid}`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show an error
    await waitFor(() => {
      expect(screen.getByText(/Version not found|Failed to load note/)).toBeInTheDocument()
    }, { timeout: 5000 })
  })
})
