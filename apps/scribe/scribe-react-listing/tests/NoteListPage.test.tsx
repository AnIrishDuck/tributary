import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { TributaryClient, TestFakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { WithFastSyncProviders, createFreshLoginClient } from './test-utils'
import { saveNote } from 'scribe-react-note/src/actions/saveNote'
import { createHomeLibrary, createLibrary } from 'scribe-data'
import * as scribeData from 'scribe-data'

describe('NoteListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render empty state when no notes exist', async () => {
    // Create a test client with a stream
    const { client, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Navigate to the note list page
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for the component to finish loading
    await waitFor(() => {
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 3000 })
    
    // Check that the empty state is displayed
    expect(screen.getByText('No notes found')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create first note' })).toBeInTheDocument()
  })

  it('should display a list of notes after saving several notes', async () => {
    // Create a test client with a stream
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Create several test notes
    const testNotes = [
      '# First Document\n\nThis is the first test document.',
      '# Second Document\n\nThis is the second test document.',
      '# Third Document\n\nThis is the third test document.',
      '# Another Document\n\nThis is another test document.'
    ]
    
    // Save each note
    for (const content of testNotes) {
      await saveNote(stream, content)
    }
    
    // Navigate to the note list page
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for the component to finish loading and show the list
    await waitFor(() => {
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 3000 })
    
    // Check that we have at least 4 note links (there may also be
    // navigation links from the Layout's bottom nav bar)
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThanOrEqual(4)
    
    // Check that all titles are displayed
    expect(screen.getByText('First Document')).toBeInTheDocument()
    expect(screen.getByText('Second Document')).toBeInTheDocument()
    expect(screen.getByText('Third Document')).toBeInTheDocument()
    expect(screen.getByText('Another Document')).toBeInTheDocument()
    
    // Check that slugs are displayed
    expect(screen.getByText('first-document')).toBeInTheDocument()
    expect(screen.getByText('second-document')).toBeInTheDocument()
    expect(screen.getByText('third-document')).toBeInTheDocument()
    expect(screen.getByText('another-document')).toBeInTheDocument()
    
    // Check that the FAB speed-dial menu is present (set via useEffect, needs waitFor)
    await waitFor(() => {
      expect(screen.getByLabelText('Open menu')).toBeInTheDocument()
    })
  })

  it('should handle notes with no titles', async () => {
    // Create a test client with a stream
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Create a note without a title (no H1 heading)
    const contentWithoutTitle = 'This note has no title heading.'
    await saveNote(stream, contentWithoutTitle)
    
    // Navigate to the note list page
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for the component to finish loading
    await waitFor(() => {
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 3000 })
    
    // Check that the untitled note is displayed
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })

  it('should render NoteListPage at /pk/:prefix/ route and load without errors', async () => {
    // This test verifies that the route /pk/:prefix/ actually renders and works
    // by creating a stream and then directly rendering the NoteListPage at its route
    
    const { client, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Create router and render the NoteListPage at its route
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for the page to fully load
    await waitFor(() => {
      // Should show "Notes" heading (NoteListPage content)
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 5000 })
    
    // Verify NO "Error loading notes" error
    const errorEl = screen.queryByText(/Error loading notes/)
    expect(errorEl).toBeNull()
  })

  it('should navigate correctly to note without double hash in URL', async () => {
    // Create a test client with a stream
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Create a test note
    const content = '# New Document\n\nThis is a test note.'
    await saveNote(stream, content)
    
    // Navigate to the note list page
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    const { container } = render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for the component to finish loading
    await waitFor(() => {
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
      expect(screen.getByText('new-document')).toBeInTheDocument()
    }, { timeout: 3000 })
    
    // Find the link to the note by selecting all links and finding the one with the title
    const links = screen.getAllByRole('link')
    const noteLink = links.find(link => link.textContent?.includes('New Document'))
    expect(noteLink).toBeInTheDocument()
    
    // Check the href attribute - it should NOT contain a double hash (/#/)
    const href = noteLink?.getAttribute('href') || ''
    
    // The bug: href will contain /#/ which causes double hash navigation
    // For example: #/pk/{prefix}/#/pk/{prefix}/{slug}
    // After fix: href should just be the path without any # prefix (in memory router)
    // In real app with hash router, the # would be added automatically
    expect(href).not.toMatch(/\/#\//)
    
    // The href should be in the correct format (without leading #, as that's handled by hash router)
    expect(href).toBe(`/pk/${base64Part}/new-document`)
  })

  it('should navigate to search page when search button clicked', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create a test note so the page loads
    await saveNote(stream, '# Test\n\nContent.')
    
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for page to fully load (not just the loading spinner which says "Loading notes...")
    // The header button "Search" only appears once loading is complete.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Search/i })).toBeInTheDocument()
    }, { timeout: 5000 })

    // Click search button
    const searchButton = screen.getByRole('button', { name: /Search/i })
    fireEvent.click(searchButton)
    
    // Should navigate to search page
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/pk/${base64Part}/search`)
    })
  })

  it('should show collections above notes when library has child collections', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    // Create a collection under the library root
    await scribeData.createCollection(stream, {
      title: 'My Recipes',
      parent_collection_uuid: library!.collection_uuid,
      inserter: 'test-user'
    })
    await stream.sync(1000)
    await scribeData.indexAll(localDb)

    // Create a root-level note (no collection)
    await saveNote(stream, '# Root Note\n\nA root-level note.')

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Collection should appear
    expect(screen.getByText('My Recipes')).toBeInTheDocument()

    // Root-level note should appear
    expect(screen.getByText('Root Note')).toBeInTheDocument()
  })

  it('should filter out notes that are in collections from root listing', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    // Create a collection
    const col = await scribeData.createCollection(stream, {
      title: 'Recipes',
      parent_collection_uuid: library!.collection_uuid,
      inserter: 'test-user'
    })
    await stream.sync(1000)
    await scribeData.indexAll(localDb)

    // Create a note in the collection
    await saveNote(stream, '# In Collection\n\nThis is inside the collection.', 'web-ui', undefined, col.collection_uuid)

    // Create a root-level note
    await saveNote(stream, '# At Root\n\nThis is at root level.')

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Root note should appear
    expect(screen.getByText('At Root')).toBeInTheDocument()

    // Note inside collection should NOT appear at root
    expect(screen.queryByText('In Collection')).toBeNull()

    // Collection should appear
    expect(screen.getByText('Recipes')).toBeInTheDocument()
  })

  it('should load library root via direct link on fresh login (sync discovers linked library)', async () => {
    // Simulate: User A creates a library with a note, User B logs in fresh
    // and navigates directly to the library root URL.
    const { clientB, linkedStreamId } = await createFreshLoginClient('Shared Library')

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${linkedStreamId}/`]
    })

    render(
      <WithFastSyncProviders client={clientB}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    // The sync loop should discover the linked library, register it, sync it,
    // and then NoteListPage should render instead of showing an error.
    await waitFor(() => {
      expect(screen.getByText('Shared Library')).toBeInTheDocument()
    }, { timeout: 15000 })

    // Should NOT show "Could not get local database" error
    expect(screen.queryByText(/Could not get local database/)).toBeNull()
  })

  it('should show loading state when library schema is not yet synced', async () => {
    const server = new TestFakeServer()

    // Client A: create a library with content
    const clientA = new TributaryClient({ server, db: new PGlite('memory://') })
    const homeKeyPairA = nacl.sign.keyPair()
    const { stream: homeStreamA } = await createHomeLibrary(clientA, 'Home A', homeKeyPairA)
    const { streamId: linkedStreamId, privateKeyBase64 } = await createLibrary(clientA, 'Schema Test', homeStreamA)
    await clientA.sync(1000)

    // Client B: register the linked key WITHOUT syncing — schema not ready
    const clientB = new TributaryClient({ server, db: new PGlite('memory://') })
    const homeKeyPairB = nacl.sign.keyPair()
    await createHomeLibrary(clientB, 'Home B', homeKeyPairB)
    const privateKeyBytes = base64url.decode(privateKeyBase64)
    await clientB.addWriteKey('scribe', privateKeyBytes)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${linkedStreamId}/`]
    })

    render(
      <WithProviders client={clientB}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should render the page shell (not an error) because the library hasn't synced yet
    await waitFor(() => {
      expect(screen.getByText('Notes')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Should NOT show any schema or load error
    expect(screen.queryByText(/Error/)).toBeNull()
    expect(screen.queryByText(/schema could not be loaded/)).toBeNull()
  })

  it('should show edit button on root library view and open edit modal', async () => {
    const { client, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for the root page to load (library name = 'Test Stream')
    await waitFor(() => {
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Edit collection button should be present on the root view
    const editButton = screen.getByRole('button', { name: 'Edit collection' })
    expect(editButton).toBeInTheDocument()

    // Click it to open the modal
    fireEvent.click(editButton)

    await waitFor(() => {
      expect(screen.getByText('Edit Collection')).toBeInTheDocument()
    })

    // Modal should have the library name pre-filled
    const input = screen.getByLabelText('Name')
    expect(input).toHaveValue('Test Stream')
  })

  it('should show schema error when library is fully synced but schema is missing', async () => {
    const server = new TestFakeServer()

    // Create a completely empty stream (no syncedMigrations, no content)
    const clientA = new TributaryClient({ server, db: new PGlite('memory://') })
    const emptyKeyPair = nacl.sign.keyPair()
    await clientA.addWriteKey('scribe', emptyKeyPair.secretKey)

    // Client B: register the same key and let sync loop run
    const clientB = new TributaryClient({ server, db: new PGlite('memory://') })
    const homeKeyPairB = nacl.sign.keyPair()
    await createHomeLibrary(clientB, 'Home B', homeKeyPairB)
    await clientB.addWriteKey('scribe', emptyKeyPair.secretKey)

    const streamId = base64url.encode(Buffer.from(emptyKeyPair.publicKey))

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${streamId}/`]
    })

    render(
      <WithFastSyncProviders client={clientB}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    // The sync loop will sync the empty stream (completes immediately since no blobs),
    // marking it as synced. But schema tables don't exist → should show schema error.
    await waitFor(() => {
      expect(screen.getByText(/schema could not be loaded/)).toBeInTheDocument()
    }, { timeout: 15000 })
  })

  it('should transition from loading to library view once sync completes', async () => {
    const { clientB, linkedStreamId } = await createFreshLoginClient('Sync Library')

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${linkedStreamId}/`]
    })

    render(
      <WithFastSyncProviders client={clientB}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    // After sync completes, should show the library name (schema arrived via sync)
    await waitFor(() => {
      expect(screen.getByText('Sync Library')).toBeInTheDocument()
    }, { timeout: 15000 })

    // Should NOT show any error
    expect(screen.queryByText(/Error/)).toBeNull()
    expect(screen.queryByText(/schema could not be loaded/)).toBeNull()
  })
})
