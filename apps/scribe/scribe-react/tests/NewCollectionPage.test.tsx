import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestClientWithStream, WithProviders } from './test-utils'
import * as scribeData from 'scribe-data'

describe('NewCollectionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render title input and create button', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/new-collection`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('New Collection')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Title input should be present
    const titleInput = screen.getByPlaceholderText('Enter collection title...')
    expect(titleInput).toBeInTheDocument()

    // Create button should be present
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()

    // Cancel button should be present
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('should create a collection and navigate to its slug', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/new-collection`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('New Collection')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Type a collection title
    const titleInput = screen.getByPlaceholderText('Enter collection title...')
    fireEvent.change(titleInput, { target: { value: 'My Recipes' } })

    // Click create
    const createButton = screen.getByRole('button', { name: 'Create' })
    fireEvent.click(createButton)

    // Should navigate to the new collection's slug
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/pk/${base64Part}/my-recipes`)
    }, { timeout: 10000 })
  })

  it('should create a collection with parent UUID from query param', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // First create a parent collection
    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    const parent = await scribeData.createCollection(stream, {
      title: 'Parent Collection',
      parent_collection_uuid: library!.collection_uuid,
      inserter: 'test-user'
    })

    await stream.sync(1000)
    await scribeData.indexAll(localDb)

    // Navigate to new-collection with parent query param
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/new-collection?parent=${parent.collection_uuid}`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('New Collection')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Type and create
    const titleInput = screen.getByPlaceholderText('Enter collection title...')
    fireEvent.change(titleInput, { target: { value: 'Child Collection' } })

    const createButton = screen.getByRole('button', { name: 'Create' })
    fireEvent.click(createButton)

    // Should navigate to the child collection's full slug path (hierarchical)
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/pk/${base64Part}/parent-collection/child-collection`)
    }, { timeout: 10000 })

    // Verify the collection was created with the correct parent
    await scribeData.indexAll(localDb)
    const children = await scribeData.getChildCollections(localDb, parent.collection_uuid)
    expect(children).toHaveLength(1)
    expect(children[0].title).toBe('Child Collection')
  })
})
