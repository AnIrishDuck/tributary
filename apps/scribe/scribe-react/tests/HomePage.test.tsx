import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import nacl from 'tweetnacl'
import React from 'react'
import HomePage from '../src/pages/HomePage'
import { createTestTributaryClient, TributaryProvider } from 'scribe-react-common/src/context/tributaryContext'
import { SyncStatusProvider } from 'scribe-react-common/src/context/syncStatusContext'
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

/** Wraps children with SyncStatusProvider + TributaryProvider using a real (fast) sync loop. */
function SyncProviders({ client, children, pollInterval = 50 }: { client: any, children: React.ReactNode, pollInterval?: number }) {
  return React.createElement(
    SyncStatusProvider,
    { client, pollInterval },
    React.createElement(TributaryProvider, { client }, children)
  )
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
    expect(screen.getByRole('button', { name: /create new library/i })).toBeInTheDocument()

    // Check for "Import Existing Library" button
    expect(screen.getByRole('button', { name: /import existing library/i })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: /create new library/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import existing library/i })).toBeInTheDocument()
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

    // Should have the link to the library (uses named route by default)
    const libraryLink = screen.getByRole('link', { name: new RegExp(`pk/${streamId.substring(0, 16)}`) })
    expect(libraryLink).toBeInTheDocument()
    expect(libraryLink).toHaveAttribute('href', '/n/test-stream/')

    // Should show action buttons at the top of "Your Libraries" section
    expect(screen.getByRole('button', { name: /create new library/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import existing library/i })).toBeInTheDocument()
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

  it('should not oscillate between "no libraries" and "syncing" on fresh login', async () => {
    const { client } = createTestTributaryClient()

    // Wrap client.list() to add a small delay, simulating realistic async behavior.
    // Without this, the in-memory client resolves instantly and React batches
    // the isSyncing=true and isSyncing=false updates together, hiding the bug.
    const originalList = client.list.bind(client)
    client.list = async () => {
      await new Promise(resolve => setTimeout(resolve, 5))
      return originalList()
    }

    const router = createMemoryRouter(routes, { initialEntries: ['/'] })

    render(
      <SyncProviders client={client} pollInterval={10}>
        <RouterProvider router={router} />
      </SyncProviders>
    )

    // Wait for the initial sync to complete and "No libraries yet" to appear
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no libraries yet/i })).toBeInTheDocument()
    }, { timeout: 2000 })

    // Sample the UI across multiple sync loop iterations to detect oscillation.
    // The bug causes "Syncing your libraries" to flash between renders because
    // the sync loop sets isSyncing=true at the start of every iteration, even
    // when there are no streams.
    let sawSyncing = false
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 20))
      if (screen.queryByText(/syncing your libraries/i)) {
        sawSyncing = true
        break
      }
    }

    expect(sawSyncing).toBe(false)
    expect(screen.getByRole('heading', { name: /no libraries yet/i })).toBeInTheDocument()
  })

  it('should not get stuck when sync loop errors on first attempt', async () => {
    const { client } = createTestTributaryClient()

    // Simulate a transient network failure: list() throws twice, then works.
    let calls = 0
    const originalList = client.list.bind(client)
    client.list = async () => { if (++calls <= 2) throw new Error('network'); return originalList() }

    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(
      <SyncProviders client={client} pollInterval={50}>
        <RouterProvider router={router} />
      </SyncProviders>
    )

    // App must recover and show the empty state — not stay stuck forever.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no libraries yet/i })).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should show libraries after sync completes on login', async () => {
    const { client } = createTestTributaryClient()
    await createTestLibrary(client, 'My Library')

    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(
      <SyncProviders client={client} pollInterval={50}>
        <RouterProvider router={router} />
      </SyncProviders>
    )

    // With the real sync loop running, the library must appear.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your libraries/i })).toBeInTheDocument()
    }, { timeout: 5000 })

    // Must not be stuck on loading or syncing screens.
    expect(screen.queryByText(/loading your libraries/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/syncing your libraries/i)).not.toBeInTheDocument()
  })

  it('should show empty state after sync completes with no libraries', async () => {
    const { client } = createTestTributaryClient()

    const router = createMemoryRouter(routes, { initialEntries: ['/'] })
    render(
      <SyncProviders client={client} pollInterval={50}>
        <RouterProvider router={router} />
      </SyncProviders>
    )

    // With the real sync loop running, should settle on empty state.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no libraries yet/i })).toBeInTheDocument()
    }, { timeout: 5000 })

    expect(screen.queryByText(/loading your libraries/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/syncing your libraries/i)).not.toBeInTheDocument()
  })

  it('should show inline create card when "Create New Library" is clicked', async () => {
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

    // Click "Create New Library" button
    fireEvent.click(screen.getByRole('button', { name: /create new library/i }))

    // Should show the inline create card
    expect(screen.getByRole('heading', { name: /create library/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/library name/i)).toBeInTheDocument()
  })

  it('should show inline create card when navigating to /?create', async () => {
    const { client } = createTestTributaryClient()

    const router = createMemoryRouter(routes, {
      initialEntries: ['/?create']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create library/i })).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('should redirect /new to /?create', async () => {
    const { client } = createTestTributaryClient()

    const router = createMemoryRouter(routes, {
      initialEntries: ['/new']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should end up on the home page with the create card visible
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /create library/i })).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('should create a library inline and navigate to it', async () => {
    const { client } = createTestTributaryClient()

    // Set up home library so createLibrary can work
    const homeKeyPair = nacl.sign.keyPair()
    await createHomeLibrary(client, 'Home', homeKeyPair)

    const router = createMemoryRouter(routes, {
      initialEntries: ['/?create']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/library name/i)).toBeInTheDocument()
    }, { timeout: 2000 })

    // Fill in the name and click Create
    fireEvent.change(screen.getByPlaceholderText(/library name/i), { target: { value: 'My Notes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    // Should show creating state
    await waitFor(() => {
      expect(screen.getByText('Creating...')).toBeInTheDocument()
    }, { timeout: 2000 })

    // Wait for the create card to disappear (library created successfully and navigated away)
    await waitFor(() => {
      expect(screen.queryByText('Creating...')).not.toBeInTheDocument()
      expect(screen.queryByPlaceholderText(/library name/i)).not.toBeInTheDocument()
    }, { timeout: 15000 })

    // Verify a new library was created (home + new library = 2)
    const libs = await getLibraries(client)
    expect(libs.length).toBe(2)
  })
})
