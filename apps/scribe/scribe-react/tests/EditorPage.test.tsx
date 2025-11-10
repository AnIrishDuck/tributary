import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createTestClientWithStream } from './test-utils'
import { TributaryProvider, createTestTributaryClient } from '../src/context/tributaryContext'
import { routes } from '../src/route'
import { getBlockCount } from 'scribe-data/src/block'

describe('EditorPage', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('should render the editor page with document title', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/pk/test-prefix/test-slug']
    })
    
    const { client } = createTestTributaryClient()
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for the component to render fully
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Document' })).toBeInTheDocument()
    })
  })

  it('should render the editor page for new document', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/pk/test-prefix/new']
    })
    
    const { client } = createTestTributaryClient()
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for the component to render fully
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Document' })).toBeInTheDocument()
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
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for the component to render fully
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Document' })).toBeInTheDocument()
    })
    
    const saveButton = screen.getByRole('button', { name: 'Add' })
    fireEvent.click(saveButton)
    
    // Check that loading state is displayed immediately
    expect(saveButton).toBeDisabled()

    // Wait for the save operation to complete and verify a block was created
    await waitFor(async () => {
      // Check that the client has blocks in the stream
      if (client && prefix) {
        const parts = prefix.split('/')
        const base64Part = parts[1]
        const stream = await client.get('scribe', base64Part)
        if (stream) {
          // Use the appropriate operation from the scribe-data block module
          const count = await getBlockCount(stream)
          expect(count).toBeGreaterThan(0)
        }
      }
    }, { timeout: 5000 })
  })

  it('should handle save errors gracefully', async () => {
    const { client, prefix } = await createTestClientWithStream()
    
    // Mock the list method to throw an error
    if (client) {
      vi.spyOn(client, 'get').mockRejectedValue(new Error('Stream error'))
    }
    
    // Extract just the base64 part for the route parameter (remove the 'pk/' prefix)
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/new`]
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for the component to render fully
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Document' })).toBeInTheDocument()
    })
    
    const saveButton = screen.getByRole('button', { name: 'Add' })
    fireEvent.click(saveButton)
    
    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText(/Failed to save document/)).toBeInTheDocument()
    }, { timeout: 2000 })
  })
})
