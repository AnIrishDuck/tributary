import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { TributaryProvider } from '../src/context/tributaryContext'
import { createTestClientWithStream } from './test-utils'
import { saveBlock } from '../src/actions/saveBlock'
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
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search documents/i)).toBeInTheDocument()
    })
  })

  it('should display empty state when no query entered', async () => {
    const { client, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    await waitFor(() => {
      expect(screen.getByText(/Search Your Documents/i)).toBeInTheDocument()
    })
  })

  it('should find and display matching documents', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create test documents
    await saveBlock(stream, '# JavaScript Tutorial\n\nLearn JavaScript basics and advanced concepts.')
    await saveBlock(stream, '# Python Guide\n\nPython programming essentials.')
    
    // Index search vectors
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Render search page with query
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=JavaScript`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for results
    await waitFor(() => {
      expect(screen.getByText('JavaScript Tutorial')).toBeInTheDocument()
    }, { timeout: 3000 })
    
    // Should not show Python document
    expect(screen.queryByText('Python Guide')).not.toBeInTheDocument()
  })

  it('should show no results message when query has no matches', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create a document
    await saveBlock(stream, '# JavaScript Tutorial\n\nLearn JavaScript.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search for non-matching term
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=Python`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
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
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    const searchInput = await screen.findByPlaceholderText(/Search documents/i)
    
    // Type in search
    fireEvent.change(searchInput, { target: { value: 'test query' } })
    
    // Wait for debounce and URL update
    await waitFor(() => {
      expect(router.state.location.search).toContain('q=test')
    }, { timeout: 1000 })
  })

  it('should navigate to document when result clicked', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create and index a document
    const { blockSlug } = await saveBlock(stream, '# Test Document\n\nTest content.')
    const localDb = stream.local()
    await indexAll(localDb)
    
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=Test`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for result and click it
    const resultLink = await screen.findByText('Test Document')
    fireEvent.click(resultLink)
    
    // Should navigate to the document
    await waitFor(() => {
      expect(router.state.location.pathname).toContain(blockSlug?.slug)
    })
  })

  it('should search for multiple words', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create test documents
    await saveBlock(stream, '# JavaScript Tutorial\n\nLearn JavaScript basics.')
    await saveBlock(stream, '# Python Tutorial\n\nLearn Python basics.')
    await saveBlock(stream, '# JavaScript Advanced\n\nAdvanced JavaScript concepts.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search for "JavaScript basics"
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=JavaScript+basics`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Should find the JavaScript Tutorial (has both words)
    await waitFor(() => {
      expect(screen.getByText('JavaScript Tutorial')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should display result count', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create test documents
    await saveBlock(stream, '# JavaScript Tutorial\n\nLearn JavaScript.')
    await saveBlock(stream, '# JavaScript Guide\n\nJavaScript programming.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=JavaScript`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Should show result count
    await waitFor(() => {
      expect(screen.getByText(/2 results/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should handle documents with no title', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create document without title
    await saveBlock(stream, 'This document has no title but contains searchable text.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=searchable`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Should show "Untitled Document"
    await waitFor(() => {
      expect(screen.getByText('Untitled Document')).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should show create new document button in no results state', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create a document
    await saveBlock(stream, '# Test Document\n\nTest content.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search for non-matching term
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=nonexistent`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create New Document/i })).toBeInTheDocument()
    })
  })

  it('should navigate to new document page when create button clicked', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    
    // Create a document
    await saveBlock(stream, '# Test Document\n\nTest content.')
    
    // Index
    const localDb = stream.local()
    await indexAll(localDb)
    
    // Search for non-matching term
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/search?q=nonexistent`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    const createButton = await screen.findByRole('button', { name: /Create New Document/i })
    fireEvent.click(createButton)
    
    // Should navigate to new document page
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/pk/${base64Part}/new`)
    })
  })
})
