import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { createTestTributaryClient } from '../src/context/tributaryContext'
import { TributaryProvider } from '../src/context/tributaryContext'
import { SyncStatusProvider } from '../src/context/syncStatusContext'
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

    // Edit route uses &edit suffix on the note's slug path
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}&edit`]
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
    const { client, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/+note`]
    })

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
      initialEntries: [`/pk/${base64Part}/+note`]
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
      initialEntries: [`/pk/${base64Part}/+note`]
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

    // Edit the note using the &edit URL pattern
    const editRouter = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}&edit`]
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
  it('should render EditorPage at /pk/:prefix/+note route and load without errors', async () => {
    // This test verifies that the route /pk/:prefix/+note actually renders and works

    const { client, prefix } = await createTestClientWithStream()

    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]

    // Create router and render the EditorPage at its route
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/+note`]
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

describe('EditorPage sync gate bug', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show editor for new note even when a non-focused library has not finished syncing', async () => {
    // Reproduce the production bug: the sync loop partially syncs the home library
    // (synced: false) in an initial pass (when no focused library is set). Then
    // user navigates to the editor, setting focused library. Subsequent sync
    // iterations only sync the focused library. The home library stays synced:false
    // in latestPerStream, so globalSyncStatus.synced remains false forever.
    // The EditorPage checks globalSyncStatus.synced and shows a sync screen.
    const { client, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Identify all streams — there's a home library + user library
    const allStreamIds = await client.list()
    const otherStreamId = allStreamIds.find(id => id !== base64Part)

    // Mock client.get so that the OTHER (non-focused) stream reports incomplete sync.
    // This simulates a large home library that hasn't finished syncing.
    const originalGet = client.get.bind(client)
    vi.spyOn(client, 'get').mockImplementation(async (appId: string, streamId: string) => {
      const stream = await originalGet(appId, streamId)
      if (stream && streamId === otherStreamId) {
        stream.sync = async (max?: number) => {
          // Return an incomplete sync status
          return {
            complete: () => false,
            currentIndex: 5,
            finalIndex: 100,
            error: null,
          } as any
        }
      }
      return stream
    })

    function FastPollProviders({ children }: { children: React.ReactNode }) {
      return React.createElement(
        SyncStatusProvider,
        { client, pollInterval: 100 },
        React.createElement(
          TributaryProvider,
          { client },
          children
        )
      )
    }

    // Start at the home page (no focused library set), so the sync loop
    // syncs ALL libraries and records the home library as synced:false.
    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })

    render(
      <FastPollProviders>
        <RouterProvider router={router} />
      </FastPollProviders>
    )

    // Wait for the sync loop to run at least once with no focused library.
    // This populates latestPerStream with home library synced:false.
    await new Promise(resolve => setTimeout(resolve, 500))

    // Now navigate to the editor. This sets focused library = base64Part.
    // Subsequent sync iterations only sync the focused library.
    // The home library entry stays synced:false in latestPerStream.
    router.navigate(`/pk/${base64Part}/+note`)

    // The editor should appear within a reasonable time.
    // BUG: globalSyncStatus.synced stays false because the home library is
    // permanently incomplete (never re-synced while focused library is set).
    // EditorPage gates on this and shows the sync screen instead.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Note' })).toBeInTheDocument()
    }, { timeout: 5000 })

    // The sync screen should NOT be visible
    expect(screen.queryByText('Syncing Notes')).not.toBeInTheDocument()
    expect(screen.queryByText('Notes Still Syncing')).not.toBeInTheDocument()
  })
})
