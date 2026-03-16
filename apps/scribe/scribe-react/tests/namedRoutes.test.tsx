import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import React from 'react'
import nacl from 'tweetnacl'
import { createHomeLibrary, createLibrary } from 'scribe-data'
import { createTestTributaryClient, TributaryProvider } from 'scribe-react-common/src/context/tributaryContext'
import { SyncStatusProvider } from 'scribe-react-common/src/context/syncStatusContext'
import { routes } from '../src/route'

function TestProviders({ client, children }: { client: any, children: React.ReactNode }) {
  return React.createElement(
    SyncStatusProvider,
    { client, pollInterval: 60000 },
    React.createElement(TributaryProvider, { client }, children)
  )
}

describe('Named Routes Integration', () => {
  it('should render pk route at /pk/:prefix/', async () => {
    const { client } = createTestTributaryClient()
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)
    const { prefix } = await createLibrary(client, 'Test Library', homeStream)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${prefix}/`],
    })

    render(
      <TestProviders client={client}>
        <RouterProvider router={router} />
      </TestProviders>
    )

    // Should render something (the NoteListPage or loading state) without error
    await waitFor(() => {
      // The page should not show a route error
      const errorElement = screen.queryByText('ERROR: NOTE')
      // It should either show the library content or a loading state
      expect(errorElement).toBeNull()
    }, { timeout: 5000 })
  })

  it('should render named route at /n/:librarySlug/', async () => {
    const { client } = createTestTributaryClient()
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)
    await createLibrary(client, 'Test Library', homeStream)

    const router = createMemoryRouter(routes, {
      initialEntries: ['/n/test-library'],
    })

    render(
      <TestProviders client={client}>
        <RouterProvider router={router} />
      </TestProviders>
    )

    // Should either show loading/resolving or the library content — not an error
    await waitFor(() => {
      const resolving = screen.queryByText('Resolving library...')
      const errorElement = screen.queryByText('ERROR: NOTE')
      // Either resolving or resolved, but not an error
      expect(errorElement).toBeNull()
    })
  })

  it('should show not found for unmatched named route when sync is done', async () => {
    const { client } = createTestTributaryClient()
    const homeKeyPair = nacl.sign.keyPair()
    await createHomeLibrary(client, 'Home', homeKeyPair)

    const router = createMemoryRouter(routes, {
      initialEntries: ['/n/nonexistent'],
    })

    render(
      <TestProviders client={client}>
        <RouterProvider router={router} />
      </TestProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Library Not Found')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('pk and named routes should share the same child route structure', () => {
    // Verify that both pk and named routes use the same libraryRoutes children
    const layoutRoute = routes[0]
    const children = layoutRoute.children!
    const pkRoute = children.find(r => r.path === '/pk/:prefix')
    const namedRoute = children.find(r => r.path === '/n/:librarySlug')

    expect(pkRoute).toBeDefined()
    expect(namedRoute).toBeDefined()
    // Both should have the same children array (shared libraryRoutes)
    expect(pkRoute!.children).toBe(namedRoute!.children)
  })

  it('shared libraryRoutes should include index, search, and catch-all routes', () => {
    const layoutRoute = routes[0]
    const pkRoute = layoutRoute.children!.find(r => r.path === '/pk/:prefix')!
    const children = pkRoute.children!

    // Index route (NoteListPage)
    const indexRoute = children.find(r => (r as any).index === true)
    expect(indexRoute).toBeDefined()

    // Search route
    const searchRoute = children.find(r => r.path === 'search')
    expect(searchRoute).toBeDefined()

    // Catch-all slug route
    const catchAllRoute = children.find(r => r.path === '*')
    expect(catchAllRoute).toBeDefined()
  })
})
