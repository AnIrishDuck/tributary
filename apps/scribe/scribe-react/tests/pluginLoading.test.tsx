import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import React from 'react'
import nacl from 'tweetnacl'
import { createHomeLibrary, createLibrary, setLibraryPlugins } from 'scribe-data'
import { createTestTributaryClient, TributaryProvider } from 'scribe-react-common/src/context/tributaryContext'
import { SyncStatusProvider } from 'scribe-react-common/src/context/syncStatusContext'
import { usePlugins } from 'scribe-react-common/src/context/pluginContext'
import { SCRIBE_PLUGIN_API_VERSION, type ScribePlugin } from 'scribe-react-common/src/plugins/types'
import PkRouteWrapper from '../src/components/PkRouteWrapper'
import NamedRouteResolver from '../src/components/NamedRouteResolver'

// Mock useLibraryPlugins to control plugin loading without real dynamic imports
const mockedUseLibraryPlugins = vi.fn().mockReturnValue([])
vi.mock('scribe-react-common/src/plugins/useLibraryPlugins', () => ({
  useLibraryPlugins: (...args: any[]) => mockedUseLibraryPlugins(...args),
}))

function makePlugin(overrides: Partial<ScribePlugin> = {}): ScribePlugin {
  return {
    name: 'test-plugin',
    apiVersion: SCRIBE_PLUGIN_API_VERSION,
    ...overrides,
  }
}

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

describe('plugin loading in route wrappers', () => {
  beforeEach(() => {
    mockedUseLibraryPlugins.mockReset()
    mockedUseLibraryPlugins.mockReturnValue([])
  })

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

    it('plugins from useLibraryPlugins appear in context', async () => {
      const { client } = createTestTributaryClient()
      const pluginA = makePlugin({ name: 'plugin-a' })
      const pluginB = makePlugin({ name: 'plugin-b' })
      mockedUseLibraryPlugins.mockReturnValue([pluginA, pluginB])

      renderPkRoute(client, 'some-prefix')

      await waitFor(() => {
        expect(screen.getByTestId('plugin-count')).toHaveTextContent('2')
      })

      expect(screen.getByTestId('plugin-names')).toHaveTextContent('plugin-a,plugin-b')
    })

    it('passes client and prefix to useLibraryPlugins', async () => {
      const { client } = createTestTributaryClient()
      renderPkRoute(client, 'test-prefix-123')

      await waitFor(() => {
        expect(mockedUseLibraryPlugins).toHaveBeenCalled()
      })

      expect(mockedUseLibraryPlugins).toHaveBeenCalledWith(client, 'test-prefix-123')
    })

    it('provides empty plugins when hook returns empty array', async () => {
      const { client } = createTestTributaryClient()
      mockedUseLibraryPlugins.mockReturnValue([])

      renderPkRoute(client, 'empty-prefix')

      await waitFor(() => {
        expect(screen.getByTestId('plugin-count')).toHaveTextContent('0')
      })
    })

    it('skips null plugins (failed loads filtered by hook)', async () => {
      const { client } = createTestTributaryClient()
      const goodPlugin = makePlugin({ name: 'good-plugin' })
      // Hook returns only successfully loaded plugins (nulls already filtered)
      mockedUseLibraryPlugins.mockReturnValue([goodPlugin])

      renderPkRoute(client, 'partial-prefix')

      await waitFor(() => {
        expect(screen.getByTestId('plugin-count')).toHaveTextContent('1')
      })

      expect(screen.getByTestId('plugin-names')).toHaveTextContent('good-plugin')
    })
  })

  describe('NamedRouteResolver', () => {
    async function createClientWithLibrary(name: string) {
      const { client } = createTestTributaryClient()
      const homeKeyPair = nacl.sign.keyPair()
      const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)
      const { stream, prefix, streamId } = await createLibrary(client, name, homeStream)
      return { client, stream, prefix, streamId }
    }

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

    it('passes resolved prefix to useLibraryPlugins', async () => {
      const { client, streamId } = await createClientWithLibrary('Named Plugin Lib')
      const plugin = makePlugin({ name: 'named-plugin' })
      mockedUseLibraryPlugins.mockReturnValue([plugin])

      renderNamedRoute(client, 'named-plugin-lib')

      await waitFor(() => {
        expect(screen.getByTestId('plugin-count')).toHaveTextContent('1')
      }, { timeout: 10000 })

      expect(screen.getByTestId('plugin-names')).toHaveTextContent('named-plugin')
      // Verify the hook was called with the resolved streamId
      expect(mockedUseLibraryPlugins).toHaveBeenCalledWith(client, streamId)
    })

    it('passes undefined prefix before resolution completes', async () => {
      const { client } = createTestTributaryClient()

      renderNamedRoute(client, 'nonexistent')

      // Before resolution, hook should be called with undefined prefix
      expect(mockedUseLibraryPlugins).toHaveBeenCalledWith(client, undefined)
    })
  })
})
