import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { getLibraryPlugins, setLibraryPlugins } from 'scribe-data'

describe('Plugin Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show empty plugins section', async () => {
    const { client, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/&library`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Plugins')).toBeInTheDocument()
    }, { timeout: 3000 })

    expect(screen.getByText('No plugins configured for this library.')).toBeInTheDocument()
    expect(screen.getByText('Add plugin')).toBeInTheDocument()
  })

  it('should show existing plugins', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/plugin-a.js', config_json: '{}' },
      { plugin_url: 'https://example.com/plugin-b.js', config_json: '{"mode":"dark"}' },
    ])

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/&library`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('https://example.com/plugin-a.js')).toBeInTheDocument()
    }, { timeout: 3000 })

    expect(screen.getByText('https://example.com/plugin-b.js')).toBeInTheDocument()
    expect(screen.getByText('{"mode":"dark"}')).toBeInTheDocument()
  })

  it('should open add plugin modal with trust warning', async () => {
    const { client, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/&library`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Add plugin')).toBeInTheDocument()
    }, { timeout: 3000 })

    fireEvent.click(screen.getByText('Add plugin'))

    // Trust warning is visible in the modal
    await waitFor(() => {
      expect(screen.getByText(/Plugins are remote code with full access to your decrypted note content/)).toBeInTheDocument()
    })

    expect(screen.getByText(/Execute arbitrary JavaScript in your browser/)).toBeInTheDocument()
    expect(screen.getByLabelText('Plugin URL')).toBeInTheDocument()
  })

  it('should not add plugin without confirming trust warning', async () => {
    const { client, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/&library`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Add plugin')).toBeInTheDocument()
    }, { timeout: 3000 })

    fireEvent.click(screen.getByText('Add plugin'))

    await waitFor(() => {
      expect(screen.getByLabelText('Plugin URL')).toBeInTheDocument()
    })

    // Fill in URL but don't check the trust checkbox
    fireEvent.change(screen.getByLabelText('Plugin URL'), {
      target: { value: 'https://example.com/my-plugin.js' }
    })

    // Click Add Plugin button
    fireEvent.click(screen.getByRole('button', { name: 'Add Plugin' }))

    // Should show error about trust confirmation
    await waitFor(() => {
      expect(screen.getByText('You must acknowledge the trust warning')).toBeInTheDocument()
    })
  })

  it('should add plugin after confirming trust warning', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/&library`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Add plugin')).toBeInTheDocument()
    }, { timeout: 3000 })

    fireEvent.click(screen.getByText('Add plugin'))

    await waitFor(() => {
      expect(screen.getByLabelText('Plugin URL')).toBeInTheDocument()
    })

    // Fill in URL
    fireEvent.change(screen.getByLabelText('Plugin URL'), {
      target: { value: 'https://example.com/my-plugin.js' }
    })

    // Check the trust confirmation checkbox
    fireEvent.click(screen.getByRole('checkbox'))

    // Click Add Plugin button
    fireEvent.click(screen.getByRole('button', { name: 'Add Plugin' }))

    // Plugin should appear in the list
    await waitFor(() => {
      expect(screen.getByText('https://example.com/my-plugin.js')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Verify it was persisted
    const saved = await getLibraryPlugins(stream)
    expect(saved).toHaveLength(1)
    expect(saved[0].plugin_url).toBe('https://example.com/my-plugin.js')
  })

  it('should remove a plugin', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/plugin-a.js' },
      { plugin_url: 'https://example.com/plugin-b.js' },
    ])

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/&library`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('https://example.com/plugin-a.js')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Click the first remove button
    const removeButtons = screen.getAllByTitle('Remove plugin')
    fireEvent.click(removeButtons[0])

    // Plugin A should be removed
    await waitFor(() => {
      expect(screen.queryByText('https://example.com/plugin-a.js')).not.toBeInTheDocument()
    }, { timeout: 3000 })

    // Plugin B should still be there
    expect(screen.getByText('https://example.com/plugin-b.js')).toBeInTheDocument()

    // Verify persistence
    const saved = await getLibraryPlugins(stream)
    expect(saved).toHaveLength(1)
    expect(saved[0].plugin_url).toBe('https://example.com/plugin-b.js')
  })

  it('should dismiss modal without adding plugin', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/&library`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Add plugin')).toBeInTheDocument()
    }, { timeout: 3000 })

    fireEvent.click(screen.getByText('Add plugin'))

    await waitFor(() => {
      expect(screen.getByLabelText('Plugin URL')).toBeInTheDocument()
    })

    // Click Cancel
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    // Modal should be gone
    await waitFor(() => {
      expect(screen.queryByLabelText('Plugin URL')).not.toBeInTheDocument()
    })

    // No plugins saved
    const saved = await getLibraryPlugins(stream)
    expect(saved).toHaveLength(0)
  })
})
