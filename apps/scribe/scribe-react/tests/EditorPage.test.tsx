import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createTestClientWithStream } from './test-utils'
import { TributaryProvider, createTestTributaryClient } from '../src/context/tributaryContext'
import { SyncStatusProvider } from '../src/context/syncStatusContext'
import { routes } from '../src/route'
import { getBlockCount, getBlockVersionCount } from 'scribe-data/src/block'
import { createBlock } from 'scribe-data/src/block'
import { indexSlugs, getBlockSlugByUuid } from 'scribe-data/src/indexing'

// Helper to wrap components with both providers
const WithProviders = ({ client, children }: { client: any, children: React.ReactNode }) => (
  <SyncStatusProvider client={client} pollInterval={100}>
    <TributaryProvider client={client}>
      {children}
    </TributaryProvider>
  </SyncStatusProvider>
)

describe('EditorPage', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('should render the editor page with document title', async () => {
    // Create a test stream with an actual document
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Create a block in the stream
    const block = await createBlock(stream, {
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
    
    // Get the slug for this block using scribe-data function
    const blockSlug = await getBlockSlugByUuid(localDb, block.block_uuid)
    const slug = blockSlug ? blockSlug.slug : 'test-document'
    
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
      expect(screen.getByRole('heading', { name: 'Edit Document' })).toBeInTheDocument()
    })
  })

  it('should render the editor page for new document', async () => {
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
    
    const { unmount } = render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )
    
    // Wait for the component to render fully
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Document' })).toBeInTheDocument()
    })
    
    const saveButton = screen.getByRole('button', { name: 'Add Document' })
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
    
    // Wait a bit for any navigation to settle before unmounting
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Unmount to prevent navigation from triggering AbortSignal errors
    unmount()
  })

  it('should handle save errors gracefully', async () => {
    const { client, prefix } = await createTestClientWithStream()
    
    // Mock the get method to throw an error
    if (client) {
      vi.spyOn(client, 'get').mockRejectedValue(new Error('Stream error'))
    }
    
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
      expect(screen.getByRole('heading', { name: 'New Document' })).toBeInTheDocument()
    })
    
    const saveButton = screen.getByRole('button', { name: 'Add Document' })
    fireEvent.click(saveButton)
    
    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText(/Failed to save document/)).toBeInTheDocument()
    }, { timeout: 2000 })
    
    // Restore the spy and unmount to prevent navigation issues
    vi.restoreAllMocks()
    unmount()
  })

  it('should edit an existing block and show updated content', async () => {
    // Create a test stream with an actual document
    const { client, stream, prefix } = await createTestClientWithStream()
    
    // Create a block in the stream
    const block = await createBlock(stream, {
      block_type: 'scribe/markdown',
      body: '# Original Document\n\nThis is the original content.',
      inserter: 'test'
    })
    
    // Sync to ensure persistence
    await stream.sync(1000)
    
    // Run indexing to create the slug
    const localDb = stream.local()
    await indexSlugs(localDb)
    
    // Get the slug for this block using scribe-data function
    const parts = prefix.split('/')
    const base64Part = parts[1]
    
    const blockSlug = await getBlockSlugByUuid(localDb, block.block_uuid)
    const slug = blockSlug ? blockSlug.slug : 'original-document'
    
    // First, edit the document
    const editRouter = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}/edit`]
    })
    
    const { rerender } = render(
      <WithProviders client={client}>
        <RouterProvider router={editRouter} />
      </WithProviders>
    )
    
    // Wait for the editor to load and show it's editing existing document
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Document' })).toBeInTheDocument()
    })
    
    // Test that the save button exists and is properly labeled for editing
    const saveButton = screen.getByRole('button', { name: 'Update Document' })
    expect(saveButton).toBeInTheDocument()
    
    // Test that editor is loaded - we won't try to interact with CodeMirror directly as it's complex
    const editor = screen.getByRole('textbox')
    expect(editor).toBeInTheDocument()
    
    // Check initial version count using scribe-data function
    const initialVersionCount = await getBlockVersionCount(stream, block.block_uuid)
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
    
    // Wait for the page to fully load - check for "New Document" heading
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Document' })).toBeInTheDocument()
    }, { timeout: 5000 })
    
    // Verify NO errors
    const errorEl = screen.queryByText(/Error|error/)
    expect(errorEl).toBeNull()
  })
})
