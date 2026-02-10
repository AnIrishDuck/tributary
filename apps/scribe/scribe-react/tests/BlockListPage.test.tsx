import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { TributaryProvider } from '../src/context/tributaryContext'
import { createTestClientWithStream } from './test-utils'
import { saveBlock } from '../src/actions/saveBlock'

describe('BlockListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render empty state when no blocks exist', async () => {
    // Create a test client with a stream
    const { client, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Navigate to the block list page
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for the component to finish loading
    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeInTheDocument()
    }, { timeout: 3000 })
    
    // Check that the empty state is displayed
    expect(screen.getByText('No documents found.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create your first document' })).toBeInTheDocument()
  })

  it('should display a list of blocks after saving several documents', async () => {
    // Create a test client with a stream
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Create several test blocks
    const testBlocks = [
      '# First Document\n\nThis is the first test document.',
      '# Second Document\n\nThis is the second test document.',
      '# Third Document\n\nThis is the third test document.',
      '# Another Document\n\nThis is another test document.'
    ]
    
    // Save each block
    for (const content of testBlocks) {
      await saveBlock(stream, content)
    }
    
    // Navigate to the block list page
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for the component to finish loading and show the list
    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeInTheDocument()
    }, { timeout: 3000 })
    
    // Check that we have the correct number of blocks
    const listItems = screen.getAllByRole('listitem')
    expect(listItems).toHaveLength(4)
    
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
    
    // Check that the "New Document" button is present
    expect(screen.getByRole('button', { name: '+ New Document' })).toBeInTheDocument()
  })

  it('should handle blocks with no titles', async () => {
    // Create a test client with a stream
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Create a block without a title (no H1 heading)
    const contentWithoutTitle = 'This document has no title heading.'
    await saveBlock(stream, contentWithoutTitle)
    
    // Navigate to the block list page
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for the component to finish loading
    await waitFor(() => {
      expect(screen.getByText('Documents')).toBeInTheDocument()
    }, { timeout: 3000 })
    
    // Check that the untitled document is displayed
    expect(screen.getByText('Untitled')).toBeInTheDocument()
  })
})

  it('should render BlockListPage at /pk/:prefix/ route and load without errors', async () => {
    // This test verifies that the route /pk/:prefix/ actually renders and works
    // by creating a stream and then directly rendering the BlockListPage at its route
    
    const { client, prefix } = await createTestClientWithStream()
    
    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    // Create router and render the BlockListPage at its route
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for the page to fully load
    await waitFor(() => {
      // Should show "Documents" heading (BlockListPage content)
      expect(screen.getByText('Documents')).toBeInTheDocument()
    }, { timeout: 5000 })
    
    // Verify NO "Error loading blocks" error
    const errorEl = screen.queryByText(/Error loading blocks/)
    expect(errorEl).toBeNull()
  })
