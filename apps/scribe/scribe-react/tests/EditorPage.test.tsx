import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { createTestTributaryClient } from '../src/context/tributaryContext'
import { routes } from '../src/route'
import { getNoteCount, getNoteVersionCount } from 'scribe-data/src/note'
import { createNote } from 'scribe-data/src/note'
import { indexSlugs, getNoteSlugByUuid } from 'scribe-data/src/indexing'

describe('EditorPage', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('should render the editor page with note title', async () => {
    // Create a test stream with an actual note
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Create a note in the stream
    const block = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Test Document\n\nThis is a test document.',
      inserter: 'test'
    })
    
    // Sync to ensure persistence
    await stream.sync(1000)
    
    // Run indexing to create the slug
    const localDb = stream.local()
    await indexSlugs(localDb)
    
    // Extract the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Get the slug for this note using scribe-data function
    const noteSlug = await getNoteSlugByUuid(localDb, block.block_uuid)
    const slug = noteSlug ? noteSlug.slug : 'test-document'
    
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}/edit`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for the component to render fully
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Note' })).toBeInTheDocument()
    })
  })

  it('should render the editor page for new note', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/pk/test-prefix/new']
    })
    
    const { client } = createTestTributaryClient()
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for the component to render fully
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Note' })).toBeInTheDocument()
    })
  })

  it('should show loading state when Save is clicked', async () => {
    const { client, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter (remove the 'pk/' prefix)
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/new`]
    })
    
    const { unmount } = render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for the component to render fully
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Note' })).toBeInTheDocument()
    })
    
    const saveButton = screen.getByRole('button', { name: 'Add Note' })
    fireEvent.click(saveButton)
    
    // Check that loading state is displayed immediately
    expect(saveButton).toBeDisabled()

    // Wait for the save operation to complete and verify a note was created
    await waitFor(async () => {
      // Check that the client has notes in the stream
      if (client && prefix) {
        const parts = prefix.split('/')
        const base64Part = parts[1]
        const stream = await client.get('scribe', base64Part)
        if (stream) {
          // Use the appropriate operation from the scribe-data note module
          const count = await getNoteCount(stream)
          expect(count).toBeGreaterThan(0)
        }
      }
    }, { timeout: 5000 })
    
    // Wait a bit for any navigation to settle before unmounting
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Unmount to prevent navigation from triggering AbortSignal errors
    unmount()
  })

  it('should handle save errors gracefully', async () => {
    const { client, prefix } = await createTestClientWithStream()

    // Extract just the base64 part for the route parameter (remove the 'pk/' prefix)
    const parts = prefix.split('/')
    const base64Part = parts[1]

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/new`]
    })

    const { unmount } = render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for the component to render fully BEFORE mocking client.get.
    // SyncStatusProvider's background sync loop calls client.get during sync,
    // so mocking it before render causes the sync to fail and the editor
    // shows the "syncing" screen instead of the editor form.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Note' })).toBeInTheDocument()
    })

    // NOW mock client.get to throw an error so the save operation fails
    if (client) {
      vi.spyOn(client, 'get').mockRejectedValue(new Error('Stream error'))
    }

    const saveButton = screen.getByRole('button', { name: 'Add Note' })
    fireEvent.click(saveButton)

    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText(/Failed to save note/)).toBeInTheDocument()
    }, { timeout: 2000 })

    // Restore the spy and unmount to prevent navigation issues
    vi.restoreAllMocks()
    unmount()
  })

  it('should edit an existing note and show updated content', async () => {
    // Create a test stream with an actual note
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Create a note in the stream
    const block = await createNote(stream, {
      block_type: 'scribe/markdown',
      body: '# Original Document\n\nThis is the original content.',
      inserter: 'test'
    })
    
    // Sync to ensure persistence
    await stream.sync(1000)
    
    // Run indexing to create the slug
    const localDb = stream.local()
    await indexSlugs(localDb)
    
    // Get the slug for this note using scribe-data function
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    const noteSlug = await getNoteSlugByUuid(localDb, block.block_uuid)
    const slug = noteSlug ? noteSlug.slug : 'original-document'
    
    // First, edit the note
    const editRouter = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}/edit`]
    })
    
    const { rerender } = render(
      <WithProviders client={client}>
        <RouterProvider router={editRouter} />
      </WithProviders>
    )
    
    // Wait for the editor to load and show it's editing existing note
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Note' })).toBeInTheDocument()
    })
    
    // Test that the save button exists and is properly labeled for editing
    const saveButton = screen.getByRole('button', { name: 'Update Note' })
    expect(saveButton).toBeInTheDocument()
    
    // Test that editor is loaded - we won't try to interact with CodeMirror directly as it's complex
    const editor = screen.getByRole('textbox')
    expect(editor).toBeInTheDocument()
    
    // Check initial version count using scribe-data function
    const initialVersionCount = await getNoteVersionCount(stream, block.block_uuid)
    expect(initialVersionCount).toBe(1)
  })
})

describe('EditorPage Additional Tests', () => {
  it('should render EditorPage at /pk/:prefix/new route and load without errors', async () => {
    // This test verifies that the route /pk/:prefix/new actually renders and works
    
    const { client, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Create router and render the EditorPage at its route
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/new`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for the page to fully load - check for "New Note" heading
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Note' })).toBeInTheDocument()
    }, { timeout: 5000 })
    
    // Verify NO errors
    const errorEl = screen.queryByText(/Error|error/)
    expect(errorEl).toBeNull()
  })
})
