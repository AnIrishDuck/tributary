import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import React from 'react'
import nacl from 'tweetnacl'
import { createHomeLibrary, createLibrary } from 'scribe-data'
import { createTestTributaryClient, TributaryProvider } from 'scribe-react-common/src/context/tributaryContext'
import { SyncStatusProvider } from 'scribe-react-common/src/context/syncStatusContext'
import { usePlugins } from 'scribe-react-common/src/context/pluginContext'
import PkRouteWrapper from '../src/components/PkRouteWrapper'
import NamedRouteResolver from '../src/components/NamedRouteResolver'

/** Test child that renders plugin context for assertions */
function PluginDisplay() {
  const plugins = usePlugins()
  return (
    <div>
      <span data-testid="plugin-count">{plugins.length}</span>
      <span data-testid="plugin-names">{plugins.map(p => p.name).join(',')}</span>
    </div>
  )
}

function TestProviders({ client, children }: { client: any; children: React.ReactNode }) {
  return (
    <SyncStatusProvider client={client} pollInterval={60000}>
      <TributaryProvider client={client}>
        {children}
      </TributaryProvider>
    </SyncStatusProvider>
  )
}

async function createClientWithLibrary(name: string) {
  const { client } = createTestTributaryClient()
  const homeKeyPair = nacl.sign.keyPair()
  const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)
  const { stream, prefix, streamId } = await createLibrary(client, name, homeStream)
  return { client, stream, prefix, streamId }
}

describe('plugin loading in route wrappers', () => {
  describe('PkRouteWrapper', () => {
    function renderPkRoute(client: any, streamId: string) {
      const routes = [
        {
          path: '/pk/:prefix',
          Component: PkRouteWrapper,
          children: [{ index: true, Component: PluginDisplay }],
        },
      ]
      const router = createMemoryRouter(routes, {
        initialEntries: [`/pk/${streamId}/`],
      })
      return render(
        <TestProviders client={client}>
          <RouterProvider router={router} />
        </TestProviders>
      )
    }

    it('provides empty plugins for library with no plugin config', async () => {
      const { client, streamId } = await createClientWithLibrary('No Plugins')

      renderPkRoute(client, streamId)

      await waitFor(() => {
        expect(screen.getByTestId('plugin-count')).toHaveTextContent('0')
      }, { timeout: 10000 })
    })

    it('provides empty plugins when stream does not exist', async () => {
      const { client } = createTestTributaryClient()

      renderPkRoute(client, 'nonexistent-stream-id')

      await waitFor(() => {
        expect(screen.getByTestId('plugin-count')).toHaveTextContent('0')
      })
    })

    it('provides PluginProvider to child routes', async () => {
      const { client, streamId } = await createClientWithLibrary('Plugin Provider Test')

      renderPkRoute(client, streamId)

      // PluginDisplay would throw if PluginProvider were missing
      await waitFor(() => {
        expect(screen.getByTestId('plugin-count')).toBeDefined()
      }, { timeout: 10000 })
    })
  })

  describe('NamedRouteResolver', () => {
    function renderNamedRoute(client: any, librarySlug: string) {
      const routes = [
        {
          path: '/n/:librarySlug',
          Component: NamedRouteResolver,
          children: [{ index: true, Component: PluginDisplay }],
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

    it('provides empty plugins for resolved library with no plugin config', async () => {
      const { client } = await createClientWithLibrary('Named Lib')

      renderNamedRoute(client, 'named-lib')

      await waitFor(() => {
        expect(screen.getByTestId('plugin-count')).toHaveTextContent('0')
      }, { timeout: 10000 })
    })

    it('provides PluginProvider to resolved child routes', async () => {
      const { client } = await createClientWithLibrary('Resolved Lib')

      renderNamedRoute(client, 'resolved-lib')

      await waitFor(() => {
        expect(screen.getByTestId('plugin-count')).toBeDefined()
      }, { timeout: 10000 })
    })
  })
})
