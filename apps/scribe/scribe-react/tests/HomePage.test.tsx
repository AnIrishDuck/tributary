import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import HomePage from '../src/pages/HomePage'
import { TributaryProvider, createTestTributaryClient } from '../src/context/tributaryContext'
import { createStream } from '../src/actions/createStream'
import { routes } from '../src/route'
import { getStreams } from '../src/actions/getStreams'

// Mock the useNavigate hook from react-router
const mockNavigate = vi.fn()
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate
  }
})

describe('HomePage', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('should render the home page with stream management', async () => {
    const { client } = createTestTributaryClient()
    
    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading your streams/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })
    
    // When no streams exist, should show empty state
    expect(screen.getByText(/no streams yet/i)).toBeInTheDocument()
    
    // Check for "Create New Stream" button
    expect(screen.getByRole('link', { name: /create new stream/i })).toBeInTheDocument()
    
    // Check for "Import Existing Stream" button
    expect(screen.getByRole('link', { name: /import existing stream/i })).toBeInTheDocument()
  })

  it('should display loading state while fetching streams', async () => {
    const { client } = createTestTributaryClient()
    
    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Should show loading text initially
    expect(screen.getByText(/loading your streams/i)).toBeInTheDocument()
    
    // Wait for streams to be loaded (even if empty)
    await waitFor(() => {
      expect(screen.queryByText(/loading your streams/i)).not.toBeInTheDocument()
    })
  })

  it('should display empty state when client has no streams', async () => {
    const { client } = createTestTributaryClient()
    
    // Verify client has no streams initially
    const initialStreams = await getStreams(client)
    expect(initialStreams.length).toBe(0)
    
    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for streams to load
    await waitFor(() => {
      expect(screen.queryByText(/loading your streams/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })
    
    // Should show empty state
    expect(screen.getByText(/no streams yet/i)).toBeInTheDocument()
    
    // Should not show "Your Streams" section when empty
    expect(screen.queryByText(/your streams/i)).not.toBeInTheDocument()
    
    // Should show action buttons
    expect(screen.getByRole('link', { name: /create new stream/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /import existing stream/i })).toBeInTheDocument()
  })

  it('should display list of streams when streams exist', async () => {
    // Create a client with a stream using the actual createStream function
    const { client } = createTestTributaryClient()
    
    // Create a stream using the real createStream action
    const { streamId } = await createStream(client)
    
    // Verify the stream was created
    const createdStreams = await getStreams(client)
    expect(createdStreams.length).toBe(1)
    expect(createdStreams[0]).toBe(streamId)
    
    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for streams to load
    await waitFor(() => {
      expect(screen.queryByText(/loading your streams/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })
    
    // Should show "Your Streams" section
    expect(screen.getByRole('heading', { name: /your streams/i })).toBeInTheDocument()
    
    // Should show stream count
    expect(screen.getByText(/you have 1 stream available/i)).toBeInTheDocument()
    
    // Should show the full stream ID with pk/ prefix
    const streamIdWithPrefix = `pk/${streamId}`
    expect(screen.getByText(streamIdWithPrefix)).toBeInTheDocument()
    
    // Should have the link to the stream (match by partial text since link includes sibling text)
    const streamLink = screen.getByRole('link', { name: new RegExp(`^pk/${streamId.substring(0, 8)}`) })
    expect(streamLink).toBeInTheDocument()
    expect(streamLink).toHaveAttribute('href', `/pk/${streamId}/`)
    
    // Should show action buttons at the top of "Your Streams" section
    expect(screen.getByRole('link', { name: /create new stream/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /import existing stream/i })).toBeInTheDocument()
  })

  it('should display multiple streams when multiple exist', async () => {
    // Create a client with multiple streams
    const { client } = createTestTributaryClient()
    
    // Create multiple streams using the real createStream action
    const streamIds: string[] = []
    for (let i = 0; i < 3; i++) {
      const { streamId } = await createStream(client)
      streamIds.push(streamId)
    }
    
    // Verify all streams were created
    const createdStreams = await getStreams(client)
    expect(createdStreams.length).toBe(3)
    
    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    // Wait for streams to load
    await waitFor(() => {
      expect(screen.queryByText(/loading your streams/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })
    
    // Should show correct stream count
    expect(screen.getByText(/you have 3 streams available/i)).toBeInTheDocument()
    
    // Should show all three streams (pk/ prefix followed by full stream ID)
    const streamLinks = screen.getAllByRole('link')
    expect(streamLinks.length).toBeGreaterThanOrEqual(3)
    streamIds.forEach(streamId => {
      const displayId = `pk/${streamId}`
      expect(screen.getByText(displayId)).toBeInTheDocument()
    })
  })

  it('should show "No streams yet" heading for empty state', async () => {
    const { client } = createTestTributaryClient()
    
    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })
    
    render(
      <TributaryProvider client={client}>
        <RouterProvider router={router} />
      </TributaryProvider>
    )
    
    await waitFor(() => {
      expect(screen.queryByText(/loading your streams/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })
    
    expect(screen.getByRole('heading', { name: /no streams yet/i })).toBeInTheDocument()
  })
})
