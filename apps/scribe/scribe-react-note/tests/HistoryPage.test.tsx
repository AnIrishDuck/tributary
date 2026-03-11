import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { saveNote } from '../src/actions/saveNote'
import HistoryPage from '../src/pages/HistoryPage'

function renderHistoryPage(client: any, prefix: string, blockUuid: string, slugPath: string) {
  const routes = [
    {
      path: '/history',
      element: (
        <HistoryPage
          prefix={prefix}
          blockUuid={blockUuid}
          slugPath={slugPath}
          ancestors={[]}
          libraryName="Test Library"
        />
      ),
    },
    {
      path: '/pk/:prefix/*',
      element: <div>Version view</div>,
    },
  ]

  const router = createMemoryRouter(routes, { initialEntries: ['/history'] })

  return render(
    <WithProviders client={client}>
      <RouterProvider router={router} />
    </WithProviders>
  )
}

describe('HistoryPage', () => {
  it('shows loading state while fetching', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]
    const { block } = await saveNote(stream, '# Test\n\nContent.')

    renderHistoryPage(client, base64Part, block.block_uuid, 'test')

    expect(screen.getByText('Loading version history...')).toBeInTheDocument()
  })

  it('renders a linear version history as a list of version entries', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Create a note with 3 versions
    const { block } = await saveNote(stream, '# Pasta\n\nVersion 1.')
    await saveNote(stream, '# Pasta\n\nVersion 2.', 'web-ui', block.block_uuid)
    await saveNote(stream, '# Pasta\n\nVersion 3.', 'web-ui', block.block_uuid)

    renderHistoryPage(client, base64Part, block.block_uuid, 'pasta')

    await waitFor(() => {
      expect(screen.queryByText('Loading version history...')).not.toBeInTheDocument()
    }, { timeout: 5000 })

    // Should render 3 version entries (truncated UUIDs as links)
    const links = screen.getAllByRole('link')
    const versionLinks = links.filter(l => l.getAttribute('href')?.includes('@'))
    expect(versionLinks.length).toBe(3)
  })

  it('each entry links to the @version_uuid URL', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const { block } = await saveNote(stream, '# Pasta\n\nContent.')

    renderHistoryPage(client, base64Part, block.block_uuid, 'pasta')

    await waitFor(() => {
      expect(screen.queryByText('Loading version history...')).not.toBeInTheDocument()
    }, { timeout: 5000 })

    const links = screen.getAllByRole('link')
    const versionLinks = links.filter(l => l.getAttribute('href')?.includes('@'))
    expect(versionLinks.length).toBeGreaterThanOrEqual(1)

    const href = versionLinks[0].getAttribute('href')
    expect(href).toMatch(new RegExp(`^/pk/${base64Part}/pasta@`))
  })

  it('the authoritative version is highlighted', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const { block } = await saveNote(stream, '# Pasta\n\nVersion 1.')
    await saveNote(stream, '# Pasta\n\nVersion 2.', 'web-ui', block.block_uuid)

    renderHistoryPage(client, base64Part, block.block_uuid, 'pasta')

    await waitFor(() => {
      expect(screen.getByText('current')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('shows header with Version History title and back button', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const { block } = await saveNote(stream, '# Test\n\nContent.')

    renderHistoryPage(client, base64Part, block.block_uuid, 'test')

    expect(screen.getByText('Version History')).toBeInTheDocument()
  })
})
