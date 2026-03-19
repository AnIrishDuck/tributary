import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import nacl from 'tweetnacl'
import { routes } from '../src/route'
import { WithProviders } from './test-utils'
import { createTestTributaryClient } from 'scribe-react-common/src/context/tributaryContext'
import { createHomeLibrary, setFeatureFlag } from 'scribe-data'

describe('AccountPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should display feature flags from home library', async () => {
    const { client } = createTestTributaryClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    await setFeatureFlag(stream, 'dark-mode', 'enabled')
    await setFeatureFlag(stream, 'beta-editor', 'v2')

    const router = createMemoryRouter(routes, {
      initialEntries: ['/account']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('beta-editor')).toBeInTheDocument()
    }, { timeout: 10000 })

    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(screen.getByText('dark-mode')).toBeInTheDocument()
    expect(screen.getByText('enabled')).toBeInTheDocument()
  })

  it('should show empty state when no feature flags are set', async () => {
    const { client } = createTestTributaryClient()
    const keyPair = nacl.sign.keyPair()
    await createHomeLibrary(client, 'Home', keyPair)

    const router = createMemoryRouter(routes, {
      initialEntries: ['/account']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('No feature flags set')).toBeInTheDocument()
    }, { timeout: 10000 })
  })
})
