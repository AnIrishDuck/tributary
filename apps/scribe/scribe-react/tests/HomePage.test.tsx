import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import nacl from 'tweetnacl'
import HomePage from '../src/pages/HomePage'
import { createTestTributaryClient } from 'scribe-react-common/src/context/tributaryContext'
import { createHomeLibrary, createLibrary } from 'scribe-data'
import { routes } from '../src/route'
import { getLibraries } from '../src/actions/getLibraries'
import { WithProviders } from './test-utils'

// Mock the useNavigate hook from react-router
const mockNavigate = vi.fn()
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate
  }
})

async function createTestLibrary(client: any, name: string) {
  const homeKeyPair = nacl.sign.keyPair()
  const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)
  return createLibrary(client, name, homeStream)
}

describe('HomePage', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('should render the home page with library management', async () => {
    const { client } = createTestTributaryClient()

    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for loading to complete
    await waitFor(() => {
      expect(screen.queryByText(/loading your libraries/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })

    // When no libraries exist, should show empty state
    expect(screen.getByText(/no libraries yet/i)).toBeInTheDocument()

    // Check for "Create New Library" button
    expect(screen.getByRole('link', { name: /create new library/i })).toBeInTheDocument()

    // Check for "Import Existing Library" button
    expect(screen.getByRole('link', { name: /import existing library/i })).toBeInTheDocument()
  })

  it('should display loading state while fetching libraries', async () => {
    const { client } = createTestTributaryClient()

    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show loading text initially
    expect(screen.getByText(/loading your libraries/i)).toBeInTheDocument()

    // Wait for libraries to be loaded (even if empty)
    await waitFor(() => {
      expect(screen.queryByText(/loading your libraries/i)).not.toBeInTheDocument()
    })
  })

  it('should display empty state when client has no libraries', async () => {
    const { client } = createTestTributaryClient()

    // Verify client has no libraries initially
    const initialLibraries = await getLibraries(client)
    expect(initialLibraries.length).toBe(0)

    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for libraries to load
    await waitFor(() => {
      expect(screen.queryByText(/loading your libraries/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })

    // Should show empty state
    expect(screen.getByText(/no libraries yet/i)).toBeInTheDocument()

    // Should not show "Your Libraries" section when empty
    expect(screen.queryByText(/your libraries/i)).not.toBeInTheDocument()

    // Should show action buttons
    expect(screen.getByRole('link', { name: /create new library/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /import existing library/i })).toBeInTheDocument()
  })

  it('should display list of libraries when libraries exist', async () => {
    // Create a client with a library using the actual createLibrary function
    const { client } = createTestTributaryClient()

    // Create a library using the real createLibrary action
    const { streamId } = await createTestLibrary(client, 'Test Stream')

    // Verify the library was created (includes home + test library)
    const createdLibraries = await getLibraries(client)
    expect(createdLibraries.length).toBe(2)
    const testLibrary = createdLibraries.find(l => l.libraryId === streamId)
    expect(testLibrary).toBeDefined()
    expect(testLibrary!.lastEdited).toBeNull() // No blocks yet

    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for libraries to load
    await waitFor(() => {
      expect(screen.queryByText(/loading your libraries/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })

    // Should show "Your Libraries" section
    expect(screen.getByRole('heading', { name: /your libraries/i })).toBeInTheDocument()

    // Should show library count (only linked libraries, not home)
    expect(screen.getByText(/you have 1 library available/i)).toBeInTheDocument()

    // Should show the truncated stream ID with pk/ prefix
    const displayId = `pk/${streamId.substring(0, 16)}...`
    expect(screen.getByText(displayId)).toBeInTheDocument()

    // Should have the link to the library
    const libraryLink = screen.getByRole('link', { name: new RegExp(`pk/${streamId.substring(0, 16)}`) })
    expect(libraryLink).toBeInTheDocument()
    expect(libraryLink).toHaveAttribute('href', `/pk/${streamId}/`)

    // Should show action buttons at the top of "Your Libraries" section
    expect(screen.getByRole('link', { name: /create new library/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /import existing library/i })).toBeInTheDocument()
  })

  it('should display multiple libraries when multiple exist', async () => {
    // Create a client with multiple libraries
    const { client } = createTestTributaryClient()

    // Create a home library first, then create multiple libraries
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)

    const streamIds: string[] = []
    for (let i = 0; i < 3; i++) {
      const { streamId } = await createLibrary(client, `Stream ${i + 1}`, homeStream)
      streamIds.push(streamId)
    }

    // Verify all libraries were created (includes home + 3 libraries)
    const createdLibraries = await getLibraries(client)
    expect(createdLibraries.length).toBe(4)

    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for libraries to load
    await waitFor(() => {
      expect(screen.queryByText(/loading your libraries/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })

    // Should show correct library count (only linked libraries, not home)
    expect(screen.getByText(/you have 3 libraries available/i)).toBeInTheDocument()

    // Should show all three libraries (pk/ prefix followed by truncated stream ID)
    const libraryLinks = screen.getAllByRole('link')
    expect(libraryLinks.length).toBeGreaterThanOrEqual(3)
    streamIds.forEach(streamId => {
      const displayId = `pk/${streamId.substring(0, 16)}...`
      expect(screen.getByText(displayId)).toBeInTheDocument()
    })
  })

  it('should show "No libraries yet" heading for empty state', async () => {
    const { client } = createTestTributaryClient()

    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.queryByText(/loading your libraries/i)).not.toBeInTheDocument()
    }, { timeout: 2000 })

    expect(screen.getByRole('heading', { name: /no libraries yet/i })).toBeInTheDocument()
  })
})
