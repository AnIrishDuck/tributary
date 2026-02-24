import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { saveNote } from '../src/actions/saveNote'
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
    
    // Check that the "Create New Note" button is present
    expect(screen.getByRole('button', { name: 'Create New Note' })).toBeInTheDocument()
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

  it('should render note content when navigating to note view page', async () => {
    // Create a test client with a stream
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Create a test note with unique content
    const content = '# Test Document\n\nThis is the note content that should be visible after navigation.'
    await saveNote(stream, content)
    
    // First, verify the link exists on the note list page
    const listRouter = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    const { unmount } = render(
      <WithProviders client={client}>
        <RouterProvider router={listRouter} />
      </WithProviders>
    )
    
    // Wait for the note list page to load
    await waitFor(() => {
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
      expect(screen.getByText('test-document')).toBeInTheDocument()
    }, { timeout: 3000 })
    
    // Find the link to the note
    const links = screen.getAllByRole('link')
    const noteLink = links.find(link => link.textContent?.includes('Test Document'))
    expect(noteLink).toBeInTheDocument()
    
    // Verify the link has the correct href (without double hash)
    const href = noteLink?.getAttribute('href') || ''
    expect(href).toBe(`/pk/${base64Part}/test-document`)
    
    // Clean up the first render
    unmount()
    
    // Now render the NoteViewPage directly to verify navigation would work
    // This tests that the page renders correctly with the note content
    const viewRouter = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/test-document`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={viewRouter} />
      </WithProviders>
    )
    
    // Wait for the note view page to load and display the content
    await waitFor(() => {
      // There are multiple "Test Document" h1 elements (header and content), use getAllByText
      const headings = screen.getAllByText('Test Document')
      expect(headings.length).toBeGreaterThan(0)
      
      // Content is in HTML rendered by micromark, use a flexible matcher
      expect(screen.getByText(/This is the note content that should be visible after navigation/)).toBeInTheDocument()
    }, { timeout: 3000 })
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
})
