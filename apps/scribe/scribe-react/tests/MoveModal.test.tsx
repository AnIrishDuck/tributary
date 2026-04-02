import React from 'react'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { saveNote } from 'scribe-react-note/src/actions/saveNote'
import * as scribeData from 'scribe-data'

/**
 * Helper: get the modal submit button. When the modal is open there are two
 * "Move" buttons (the page trigger and the modal submit). The modal submit
 * lives inside the modal overlay which contains the heading "Move Note" or
 * "Move Collection".
 */
function getModalMoveButton(): HTMLElement {
  const heading = screen.getByText(/^Move (Note|Collection|Image)$/)
  // Walk up to the modal container (the overlay root)
  const modal = heading.closest('.fixed')!
  return within(modal as HTMLElement).getByRole('button', { name: 'Move' })
}

describe('MoveModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('note view', () => {
    it('should show Move button on a note view page', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]

      // Create a note
      await saveNote(stream, '# My Note\n\nSome content here.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/my-note`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      // Wait for note view to load
      await waitFor(() => {
        expect(screen.getByText(/Some content here/)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Move button should be visible
      expect(screen.getByRole('button', { name: /Move/ })).toBeInTheDocument()
    })

    it('should open move modal with prepopulated target path', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]

      await saveNote(stream, '# My Note\n\nContent.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/my-note`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Content\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Click Move button
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))

      // Modal should open with split inputs prepopulated
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
        expect(screen.getByText('/my-note')).toBeInTheDocument()
        expect(screen.getByLabelText('Collection')).toBeInTheDocument()
        expect(screen.getByLabelText('Slug')).toBeInTheDocument()
        // Collection defaults to current collection (root = "/")
        expect(screen.getByLabelText('Collection')).toHaveValue('/')
        // Slug defaults to current slug
        expect(screen.getByLabelText('Slug')).toHaveValue('my-note')
      })
    })

    it('should show warning when parent path does not exist', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]

      await saveNote(stream, '# Test Note\n\nBody.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/test-note`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Body\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      // Type a collection path that doesn't exist
      const collectionInput = screen.getByLabelText('Collection')
      fireEvent.change(collectionInput, { target: { value: '/nonexistent-collection' } })

      // Should show invalid path warning about parent
      await waitFor(() => {
        expect(screen.getByText(/does not exist/)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Move button inside modal should be disabled
      expect(getModalMoveButton()).toBeDisabled()
    })

    it('should show warning when parent path resolves to a note instead of a collection', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]

      // Create two notes
      await saveNote(stream, '# Source Note\n\nSource.')
      await saveNote(stream, '# Target Note\n\nTarget.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/source-note`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Source\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      // Type a collection path that is actually a note (not a collection)
      const collectionInput = screen.getByLabelText('Collection')
      fireEvent.change(collectionInput, { target: { value: '/target-note' } })

      // Should show "is not a collection" warning
      await waitFor(() => {
        expect(screen.getByText(/is not a collection/)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Move button inside modal should be disabled
      expect(getModalMoveButton()).toBeDisabled()
    })

    it('should validate successfully when target is an existing collection', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]
      const localDb = stream.local()
      const library = await scribeData.getLibrary(localDb)

      // Create a target collection
      await scribeData.createCollection(stream, {
        title: 'Recipes',
        parent_collection_uuid: library!.collection_uuid,
        inserter: 'test-user'
      })
      await stream.sync(1000)
      await scribeData.indexAll(stream.local())

      // Create a note at the root
      await saveNote(stream, '# My Note\n\nContent.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/my-note`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Content\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      // Set collection to /recipes (slug stays as my-note)
      const collectionInput = screen.getByLabelText('Collection')
      fireEvent.change(collectionInput, { target: { value: '/recipes' } })

      // Should show valid status
      await waitFor(() => {
        expect(screen.getByText(/Will move to/)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Move button inside modal should be enabled
      expect(getModalMoveButton()).not.toBeDisabled()
    })

    it('should validate successfully when moving to root', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]
      const localDb = stream.local()
      const library = await scribeData.getLibrary(localDb)

      // Create a collection with a note inside it
      const col = await scribeData.createCollection(stream, {
        title: 'Cooking',
        parent_collection_uuid: library!.collection_uuid,
        inserter: 'test-user'
      })
      await stream.sync(1000)
      await scribeData.indexAll(stream.local())

      await saveNote(stream, '# Pasta\n\nDelicious.', 'web-ui', undefined, col.collection_uuid)

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/cooking/pasta`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Delicious\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Open modal and type root path with slug
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      // Move to root keeping the slug — change collection to /
      const collectionInput = screen.getByLabelText('Collection')
      fireEvent.change(collectionInput, { target: { value: '/' } })

      // Should show valid status for root
      await waitFor(() => {
        expect(screen.getByText(/Will move to/)).toBeInTheDocument()
      }, { timeout: 5000 })

      expect(getModalMoveButton()).not.toBeDisabled()
    })

    it('should show warning for relative path that navigates above root', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]

      // Create a note at the root level
      await saveNote(stream, '# Root Note\n\nAt root.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/root-note`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/At root\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      // Type a relative collection path that goes above the root
      const collectionInput = screen.getByLabelText('Collection')
      fireEvent.change(collectionInput, { target: { value: '../../invalid' } })

      // Should show invalid path warning
      await waitFor(() => {
        expect(screen.getByText(/navigates above library root/)).toBeInTheDocument()
      }, { timeout: 5000 })

      expect(getModalMoveButton()).toBeDisabled()
    })

    it('should successfully move a note to a collection', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]
      const localDb = stream.local()
      const library = await scribeData.getLibrary(localDb)

      // Create a target collection
      await scribeData.createCollection(stream, {
        title: 'Archive',
        parent_collection_uuid: library!.collection_uuid,
        inserter: 'test-user'
      })
      await stream.sync(1000)
      await scribeData.indexAll(stream.local())

      // Create a note at root
      await saveNote(stream, '# Movable Note\n\nWill be moved.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/movable-note`]
      })

      const { unmount } = render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Will be moved\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      // Set collection to /archive (slug stays as movable-note)
      const collectionInput = screen.getByLabelText('Collection')
      fireEvent.change(collectionInput, { target: { value: '/archive' } })

      // Wait for validation
      await waitFor(() => {
        expect(screen.getByText(/Will move to/)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Click Move inside the modal
      fireEvent.click(getModalMoveButton())

      // Should navigate to new location after move completes
      await waitFor(() => {
        // After move, modal should close and navigation should happen.
        // The router should now be at /pk/<prefix>/archive/movable-note
        expect(router.state.location.pathname).toBe(`/pk/${base64Part}/archive/movable-note`)
      }, { timeout: 10000 })

      unmount()
    })

    it('should show collision warning when target slug already exists', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]
      const localDb = stream.local()
      const library = await scribeData.getLibrary(localDb)

      // Create a collection
      const col = await scribeData.createCollection(stream, {
        title: 'Recipes',
        parent_collection_uuid: library!.collection_uuid,
        inserter: 'test-user'
      })
      await stream.sync(1000)
      await scribeData.indexAll(stream.local())

      // Create a note in the collection
      await saveNote(stream, '# Pasta\n\nExisting pasta recipe.', 'web-ui', undefined, col.collection_uuid)

      // Create another note at root that we'll try to move with a colliding slug
      await saveNote(stream, '# Other Note\n\nWill collide.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/other-note`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Will collide\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      // Move to recipes and rename slug to "pasta" — should collide
      const collectionInput = screen.getByLabelText('Collection')
      fireEvent.change(collectionInput, { target: { value: '/recipes' } })
      const slugInput = screen.getByLabelText('Slug')
      fireEvent.change(slugInput, { target: { value: 'pasta' } })

      // Should show collision warning
      await waitFor(() => {
        expect(screen.getByText(/Slug collision/)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Move button should still be enabled (collision is a warning, not a blocker)
      expect(getModalMoveButton()).not.toBeDisabled()
    })
  })

  describe('collection view', () => {
    it('should show Move button on a collection view page', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]
      const localDb = stream.local()
      const library = await scribeData.getLibrary(localDb)

      await scribeData.createCollection(stream, {
        title: 'My Collection',
        parent_collection_uuid: library!.collection_uuid,
        inserter: 'test-user'
      })
      await stream.sync(1000)
      await scribeData.indexAll(stream.local())

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/my-collection`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      // Wait for collection view to load (shows "Empty collection" for empty ones)
      await waitFor(() => {
        expect(screen.getByText('Empty collection')).toBeInTheDocument()
      }, { timeout: 5000 })

      // Move button should be visible
      expect(screen.getByRole('button', { name: /Move/ })).toBeInTheDocument()
    })

    it('should open move modal with prepopulated collection slug', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]
      const localDb = stream.local()
      const library = await scribeData.getLibrary(localDb)

      await scribeData.createCollection(stream, {
        title: 'My Collection',
        parent_collection_uuid: library!.collection_uuid,
        inserter: 'test-user'
      })
      await stream.sync(1000)
      await scribeData.indexAll(stream.local())

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/my-collection`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText('Empty collection')).toBeInTheDocument()
      }, { timeout: 5000 })

      fireEvent.click(screen.getByRole('button', { name: /Move/ }))

      await waitFor(() => {
        expect(screen.getByText('Move Collection')).toBeInTheDocument()
        expect(screen.getByText('/my-collection')).toBeInTheDocument()
        // Collections use single target path input, prepopulated with absolute path
        expect(screen.getByLabelText('Target path')).toHaveValue('/my-collection')
      })
    })
  })

  describe('modal interaction', () => {
    it('should close modal when Cancel button is clicked', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]

      await saveNote(stream, '# Test\n\nBody.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/test`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Body\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      // Click Cancel
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      // Modal should close
      await waitFor(() => {
        expect(screen.queryByText('Move Note')).not.toBeInTheDocument()
      })
    })

    it('should keep Move button disabled when input is empty', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]

      await saveNote(stream, '# Test\n\nBody.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/test`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Body\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      // Clear the slug input
      const slugInput = screen.getByLabelText('Slug')
      fireEvent.change(slugInput, { target: { value: '' } })

      // Move button inside modal should be disabled with empty slug
      expect(getModalMoveButton()).toBeDisabled()
    })

    it('should reject slug with invalid characters', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]

      await saveNote(stream, '# Test\n\nBody.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/test`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Body\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      // Open modal
      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      // Type a slug with a slash
      const slugInput = screen.getByLabelText('Slug')
      fireEvent.change(slugInput, { target: { value: 'bad/slug' } })

      await waitFor(() => {
        expect(screen.getByText(/invalid characters/)).toBeInTheDocument()
      })
      expect(getModalMoveButton()).toBeDisabled()
    })

    it('should reject slug with uppercase letters', async () => {
      const { client, stream, prefix } = await createTestClientWithStream()
      const base64Part = prefix.split('/')[1]

      await saveNote(stream, '# Test\n\nBody.')

      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${base64Part}/test`]
      })

      render(
        <WithProviders client={client}>
          <RouterProvider router={router} />
        </WithProviders>
      )

      await waitFor(() => {
        expect(screen.getByText(/Body\./)).toBeInTheDocument()
      }, { timeout: 5000 })

      fireEvent.click(screen.getByRole('button', { name: /Move/ }))
      await waitFor(() => {
        expect(screen.getByText('Move Note')).toBeInTheDocument()
      })

      const slugInput = screen.getByLabelText('Slug')
      fireEvent.change(slugInput, { target: { value: 'MyNote' } })

      await waitFor(() => {
        expect(screen.getByText(/invalid characters/)).toBeInTheDocument()
      })
      expect(getModalMoveButton()).toBeDisabled()
    })
  })
})
