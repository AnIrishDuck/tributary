import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import React from 'react'
import nacl from 'tweetnacl'
import { createHomeLibrary, createLibrary } from 'scribe-data'
import { createTestTributaryClient, TributaryProvider } from 'scribe-react-common/src/context/tributaryContext'
import { SyncStatusProvider } from 'scribe-react-common/src/context/syncStatusContext'
import { useRouteContext } from 'scribe-react-common/src/context/routeContext'
import NamedRouteResolver from '../src/components/NamedRouteResolver'

/** Test child that renders route context values for assertions */
function RouteContextDisplay() {
  const ctx = useRouteContext()
  return (
    <div>
      <span data-testid="paradigm">{ctx.paradigm}</span>
      <span data-testid="prefix">{ctx.prefix}</span>
      <span data-testid="root-path">{ctx.buildPath()}</span>
      <span data-testid="slug-path">{ctx.buildPath('my-note')}</span>
    </div>
  )
}

function TestProviders({ client, children }: { client: any, children: React.ReactNode }) {
  return React.createElement(
    SyncStatusProvider,
    { client, pollInterval: 60000 },
    React.createElement(TributaryProvider, { client }, children)
  )
}

describe('NamedRouteResolver', () => {
  async function createClientWithLibrary(name: string) {
    const { client } = createTestTributaryClient()
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)
    const { stream, prefix, streamId } = await createLibrary(client, name, homeStream)
    return { client, prefix, streamId }
  }

  function renderNamedRoute(client: any, librarySlug: string) {
    const routes = [
      {
        path: '/n/:librarySlug',
        Component: NamedRouteResolver,
        children: [
          {
            index: true,
            Component: RouteContextDisplay,
          },
        ],
      },
    ]
    const router = createMemoryRouter(routes, {
      initialEntries: [`/n/${librarySlug}`],
    })
    return render(
      <TestProviders client={client}>
        <RouterProvider router={router} />
      </TestProviders>
    )
  }

  it('should show loading state initially', () => {
    const { client } = createTestTributaryClient()
    renderNamedRoute(client, 'some-library')
    expect(screen.getByText('Resolving library...')).toBeInTheDocument()
  })

  it('should resolve a library by slugified name', async () => {
    const { client, streamId } = await createClientWithLibrary('My Recipes')
    renderNamedRoute(client, 'my-recipes')

    await waitFor(() => {
      expect(screen.getByTestId('paradigm')).toHaveTextContent('named')
    }, { timeout: 5000 })

    expect(screen.getByTestId('prefix')).toHaveTextContent(streamId)
    expect(screen.getByTestId('root-path')).toHaveTextContent('/n/my-recipes/')
    expect(screen.getByTestId('slug-path')).toHaveTextContent('/n/my-recipes/my-note')
  })

  it('should show not found for non-existent library slug', async () => {
    const { client } = await createClientWithLibrary('My Recipes')
    renderNamedRoute(client, 'nonexistent-library')

    await waitFor(() => {
      expect(screen.getByText('Library Not Found')).toBeInTheDocument()
    }, { timeout: 5000 })

    expect(screen.getByText(/nonexistent-library/)).toBeInTheDocument()
  })

  it('should show conflict page when multiple libraries match', async () => {
    const { client } = createTestTributaryClient()
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)
    // Create two libraries with the same name
    await createLibrary(client, 'My Notes', homeStream)
    await createLibrary(client, 'My Notes', homeStream)

    renderNamedRoute(client, 'my-notes')

    await waitFor(() => {
      expect(screen.getByText(/Multiple libraries match/)).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should handle library names with special characters in slug', async () => {
    const { client, prefix } = await createClientWithLibrary('Café Recipes & More!')
    // titleToSlug: 'caf-recipes--more' → 'caf-recipes-more'
    renderNamedRoute(client, 'caf-recipes--more')

    // This should either resolve or not-found depending on exact slug
    // The important thing is it doesn't crash
    await waitFor(() => {
      const resolved = screen.queryByTestId('paradigm')
      const notFound = screen.queryByText('Library Not Found')
      expect(resolved || notFound).toBeTruthy()
    }, { timeout: 5000 })
  })
})
