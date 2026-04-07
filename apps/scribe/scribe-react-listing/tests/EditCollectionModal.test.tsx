import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestClientWithStream, WithProviders, WithFastSyncProviders } from './test-utils'
import { EditCollectionModal } from 'scribe-react-common/src/components/EditCollectionModal'
import { TributaryProvider } from 'scribe-react-common/src/context/tributaryContext'
import * as scribeData from 'scribe-data'

describe('EditCollectionModal', () => {
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

  /** Helper to get the Save button inside the modal */
  function getModalSaveButton(): HTMLElement {
    const heading = screen.getByText('Edit Collection')
    const modal = heading.closest('.fixed')!
    return within(modal as HTMLElement).getByRole('button', { name: /Save/ })
  }

  /** Wait for the modal's Save button to become enabled (sync completed) */
  async function waitForSaveEnabled() {
    await waitFor(() => {
      expect(getModalSaveButton()).not.toBeDisabled()
    }, { timeout: 5000 })
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should rename a collection and persist the change in the database', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)

    const col = await createIndexedCollection(stream, 'Old Name', library!.collection_uuid)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/old-name`]
    })

    const { unmount } = render(
      <WithFastSyncProviders client={client}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    // Wait for collection page to load
    await waitFor(() => {
      expect(screen.getAllByText('Old Name').length).toBeGreaterThanOrEqual(1)
    }, { timeout: 5000 })

    // Open the edit modal
    fireEvent.click(screen.getByRole('button', { name: 'Edit collection' }))
    await waitFor(() => {
      expect(screen.getByText('Edit Collection')).toBeInTheDocument()
    })
    await waitForSaveEnabled()

    // Change the title
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'New Name' } })

    // Save
    fireEvent.click(getModalSaveButton())

    // Wait for the page to reload (navigate(0))
    await waitFor(() => {
      expect(screen.queryByText('Edit Collection')).not.toBeInTheDocument()
    }, { timeout: 10000 })

    // Verify the rename persisted in the database
    const updated = await scribeData.getCollectionByUuid(stream, col.collection_uuid)
    expect(updated).toBeDefined()
    expect(updated!.title).toBe('New Name')
    // Slug should be unchanged
    expect(updated!.slug).toBe('old-name')

    unmount()
  })

  it('should display an error when the rename fails', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)

    await createIndexedCollection(stream, 'My Collection', library!.collection_uuid)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/my-collection`]
    })

    render(
      <WithFastSyncProviders client={client}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    await waitFor(() => {
      expect(screen.getAllByText('My Collection').length).toBeGreaterThanOrEqual(1)
    }, { timeout: 5000 })

    // Open the edit modal
    fireEvent.click(screen.getByRole('button', { name: 'Edit collection' }))
    await waitFor(() => {
      expect(screen.getByText('Edit Collection')).toBeInTheDocument()
    })
    await waitForSaveEnabled()

    // Sabotage the client so the rename fails
    const origGet = client.get.bind(client)
    vi.spyOn(client, 'get').mockRejectedValueOnce(new Error('Network error'))

    // Change the title and save
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Will Fail' } })
    fireEvent.click(getModalSaveButton())

    // Error should be displayed in the modal
    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument()
    }, { timeout: 5000 })

    // Modal should still be open (not dismissed on error)
    expect(screen.getByText('Edit Collection')).toBeInTheDocument()

    // Restore client so cleanup works
    vi.restoreAllMocks()
  })

  it('should disable Save button when title is empty or whitespace', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)

    await createIndexedCollection(stream, 'My Collection', library!.collection_uuid)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/my-collection`]
    })

    render(
      <WithFastSyncProviders client={client}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    await waitFor(() => {
      expect(screen.getAllByText('My Collection').length).toBeGreaterThanOrEqual(1)
    }, { timeout: 5000 })

    // Open the edit modal
    fireEvent.click(screen.getByRole('button', { name: 'Edit collection' }))
    await waitFor(() => {
      expect(screen.getByText('Edit Collection')).toBeInTheDocument()
    })
    await waitForSaveEnabled()

    // Clear the input
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: '' } })

    // Save button should be disabled
    expect(getModalSaveButton()).toBeDisabled()

    // Whitespace-only should also be disabled
    fireEvent.change(input, { target: { value: '   ' } })
    expect(getModalSaveButton()).toBeDisabled()

    // Non-empty should enable it
    fireEvent.change(input, { target: { value: 'Valid Name' } })
    expect(getModalSaveButton()).not.toBeDisabled()
  })

  it('should disable Save button while saving is in progress', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)

    await createIndexedCollection(stream, 'My Collection', library!.collection_uuid)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/my-collection`]
    })

    render(
      <WithFastSyncProviders client={client}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    await waitFor(() => {
      expect(screen.getAllByText('My Collection').length).toBeGreaterThanOrEqual(1)
    }, { timeout: 5000 })

    // Open the edit modal
    fireEvent.click(screen.getByRole('button', { name: 'Edit collection' }))
    await waitFor(() => {
      expect(screen.getByText('Edit Collection')).toBeInTheDocument()
    })
    await waitForSaveEnabled()

    // Make client.get hang so we can observe the saving state
    let resolveGet: (v: any) => void
    const hangPromise = new Promise(r => { resolveGet = r })
    vi.spyOn(client, 'get').mockReturnValueOnce(hangPromise as any)

    // Change the title and save
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Saving Name' } })
    fireEvent.click(getModalSaveButton())

    // Button should show "Saving..." and be disabled
    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeInTheDocument()
    })
    // The save button is disabled during saving
    const heading = screen.getByText('Edit Collection')
    const modal = heading.closest('.fixed')!
    const saveBtn = within(modal as HTMLElement).getByText('Saving...').closest('button')!
    expect(saveBtn).toBeDisabled()

    // Resolve the hang with null to trigger an error path and finish
    resolveGet!(null)

    await waitFor(() => {
      expect(screen.getByText(/Library not found/)).toBeInTheDocument()
    }, { timeout: 5000 })

    vi.restoreAllMocks()
  })

  it('should close modal without saving when Cancel is clicked', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)

    const col = await createIndexedCollection(stream, 'My Collection', library!.collection_uuid)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/my-collection`]
    })

    render(
      <WithFastSyncProviders client={client}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    await waitFor(() => {
      expect(screen.getAllByText('My Collection').length).toBeGreaterThanOrEqual(1)
    }, { timeout: 5000 })

    // Open the edit modal
    fireEvent.click(screen.getByRole('button', { name: 'Edit collection' }))
    await waitFor(() => {
      expect(screen.getByText('Edit Collection')).toBeInTheDocument()
    })
    await waitForSaveEnabled()

    // Change the title but cancel
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'Should Not Save' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByText('Edit Collection')).not.toBeInTheDocument()
    })

    // Database should still have the original title
    const unchanged = await scribeData.getCollectionByUuid(stream, col.collection_uuid)
    expect(unchanged!.title).toBe('My Collection')
  })

  it('should disable Save button and show message while library is syncing', async () => {
    const { client } = await createTestClientWithStream()

    render(
      <TributaryProvider client={client}>
        <EditCollectionModal
          isOpen={true}
          onClose={() => {}}
          collectionUuid="test-uuid"
          currentTitle="My Collection"
          prefix="scribe/test"
          syncing={true}
          onSaved={() => {}}
        />
      </TributaryProvider>
    )

    // Modal should be open with the syncing message
    expect(screen.getByText('Edit Collection')).toBeInTheDocument()
    expect(screen.getByText(/syncing/i)).toBeInTheDocument()

    // Save button should be disabled even though the title is non-empty
    const heading = screen.getByText('Edit Collection')
    const modal = heading.closest('.fixed')!
    const saveBtn = within(modal as HTMLElement).getByRole('button', { name: 'Save' })
    expect(saveBtn).toBeDisabled()

    // Typing a new title should still leave Save disabled
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'New Title' } })
    expect(saveBtn).toBeDisabled()
  })

  it('should enable Save button once syncing completes', async () => {
    const { client } = await createTestClientWithStream()

    const { rerender } = render(
      <TributaryProvider client={client}>
        <EditCollectionModal
          isOpen={true}
          onClose={() => {}}
          collectionUuid="test-uuid"
          currentTitle="My Collection"
          prefix="scribe/test"
          syncing={true}
          onSaved={() => {}}
        />
      </TributaryProvider>
    )

    // Save should be disabled while syncing
    const heading = screen.getByText('Edit Collection')
    const modal = heading.closest('.fixed')!
    const saveBtn = within(modal as HTMLElement).getByRole('button', { name: 'Save' })
    expect(saveBtn).toBeDisabled()
    expect(screen.getByText(/syncing/i)).toBeInTheDocument()

    // Re-render with syncing=false (sync completed)
    rerender(
      <TributaryProvider client={client}>
        <EditCollectionModal
          isOpen={true}
          onClose={() => {}}
          collectionUuid="test-uuid"
          currentTitle="My Collection"
          prefix="scribe/test"
          syncing={false}
          onSaved={() => {}}
        />
      </TributaryProvider>
    )

    // Syncing message should be gone
    expect(screen.queryByText(/syncing/i)).not.toBeInTheDocument()

    // Save should now be enabled (title is non-empty)
    expect(saveBtn).not.toBeDisabled()
  })
})
