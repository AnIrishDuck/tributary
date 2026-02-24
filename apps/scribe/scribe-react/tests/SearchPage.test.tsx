import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { saveNote } from '../src/actions/saveNote'
import { indexAll } from 'scribe-data'

describe('SearchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render search page with search bar', async () => {
    const { client, prefix } = await createTestClientWithStream()
    
    const base64Part = prefix.split('/')[1]
    
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search notes/i)).toBeInTheDocument()
    })
  })

  it('should display empty state when no query entered', async () => {
    const { client, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    await waitFor(() => {
      expect(screen.getByText(/Search Your Notes/i)).toBeInTheDocument()
    })
  })

  it('should find and display matching notes', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create test notes
    await saveNote(stream, '# JavaScript Tutorial\n\nLearn JavaScript basics and advanced concepts.')
    await saveNote(stream, '# Python Guide\n\nPython programming essentials.')
    
    // Index search vectors
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Render search page with query
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=JavaScript`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for results
    await waitFor(() => {
      expect(screen.getByText('JavaScript Tutorial')).toBeInTheDocument()
    }, { timeout: 3000 })
    
    // Should not show Python note
    expect(screen.queryByText('Python Guide')).not.toBeInTheDocument()
  })

  it('should show no results message when query has no matches', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create a note
    await saveNote(stream, '# JavaScript Tutorial\n\nLearn JavaScript.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search for non-matching term
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=Python`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    await waitFor(() => {
      expect(screen.getByText(/No Results Found/i)).toBeInTheDocument()
    })
  })

  it('should update URL when search query changes', async () => {
    const { client, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    const searchInput = await screen.findByPlaceholderText(/Search notes/i)
    
    // Type in search
    fireEvent.change(searchInput, { target: { value: 'test query' } })
    
    // Wait for debounce and URL update
    await waitFor(() => {
      expect(router.state.location.search).toContain('q=test')
    }, { timeout: 1000 })
  })

  it('should navigate to note when result clicked', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create and index a note
    const { blockSlug } = await saveNote(stream, '# Test Document\n\nTest content.')
    const localDb = stream.local()
    await indexAll(localDb)
    
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=Test`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for result and click it
    const resultLink = await screen.findByText('Test Document')
    fireEvent.click(resultLink)
    
    // Should navigate to the note
    await waitFor(() => {
      expect(router.state.location.pathname).toContain(blockSlug?.slug)
    })
  })

  it('should search for multiple words', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create test notes
    await saveNote(stream, '# JavaScript Tutorial\n\nLearn JavaScript basics.')
    await saveNote(stream, '# Python Tutorial\n\nLearn Python basics.')
    await saveNote(stream, '# JavaScript Advanced\n\nAdvanced JavaScript concepts.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search for "JavaScript basics"
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=JavaScript+basics`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Should find the JavaScript Tutorial (has both words)
    await waitFor(() => {
      expect(screen.getByText('JavaScript Tutorial')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should display result count', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create test notes
    await saveNote(stream, '# JavaScript Tutorial\n\nLearn JavaScript.')
    await saveNote(stream, '# JavaScript Guide\n\nJavaScript programming.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=JavaScript`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Should show result count
    await waitFor(() => {
      expect(screen.getByText(/2 results/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should handle notes with no title', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create note without title
    await saveNote(stream, 'This note has no title but contains searchable text.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=searchable`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Should show "Untitled Note"
    await waitFor(() => {
      expect(screen.getByText('Untitled Note')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should show create new note button in no results state', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create a note
    await saveNote(stream, '# Test Document\n\nTest content.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search for non-matching term
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=nonexistent`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create New Note/i })).toBeInTheDocument()
    })
  })

  it('should navigate to new note page when create button clicked', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create a note
    await saveNote(stream, '# Test Document\n\nTest content.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search for non-matching term
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=nonexistent`]
    })
    
    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    const createButton = await screen.findByRole('button', { name: /Create New Note/i })
    fireEvent.click(createButton)
    
    // Should navigate to new note page
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/pk/${base64Part}/+note`)
    })
  })
})
