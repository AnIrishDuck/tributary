import React from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { saveNote } from 'scribe-react-note/src/actions/saveNote'
import { createCollection, getLibrary } from 'scribe-data'

describe('LibrarySettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render library settings with stats for an empty library', async () => {
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
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Should show statistics section
    expect(screen.getByText('Statistics')).toBeInTheDocument()
    expect(screen.getByText('Edits')).toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByText('Collections')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()

    // Empty library should have 0 edits, 0 notes, 0 collections
    const zeros = screen.getAllByText('0')
    expect(zeros.length).toBe(3)

    // Should show sharing section
    expect(screen.getByText('Sharing')).toBeInTheDocument()
    expect(screen.getByText('Copy share link')).toBeInTheDocument()
  })

  it('should display correct counts after adding notes and collections', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Create some notes (each saveNote creates a block row)
    await saveNote(stream, '# Note One\n\nFirst note.')
    await saveNote(stream, '# Note Two\n\nSecond note.')

    // Create a collection
    const library = await getLibrary(stream)
    await createCollection(stream, {
      title: 'My Collection',
      parent_collection_uuid: library!.collection_uuid,
      inserter: 'test',
    })

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/&library`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    await waitFor(() => {
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Verify stats: each stat box has a count (p tag) and label (p tag)
    // Check the count values within their respective stat containers
    const editsContainer = screen.getByText('Edits').parentElement!
    const notesContainer = screen.getByText('Notes').parentElement!
    const collectionsContainer = screen.getByText('Collections').parentElement!

    expect(editsContainer.querySelector('p')!.textContent).toBe('2')
    expect(notesContainer.querySelector('p')!.textContent).toBe('2')
    expect(collectionsContainer.querySelector('p')!.textContent).toBe('1')

    // Storage stat should be visible
    expect(screen.getByText('Storage')).toBeInTheDocument()
  })

  it('should show back link to home', async () => {
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
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Should have a back link to home (← Home)
    const backLink = screen.getByText(/← Home/)
    expect(backLink).toBeInTheDocument()
    expect(backLink.closest('a')).toHaveAttribute('href', '/')
  })

  it('should show bookmarklet section with copy button and mobile instructions', async () => {
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
      expect(screen.getByText('Test Stream')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Should show bookmarklet section
    expect(screen.getByText('Bookmarklet')).toBeInTheDocument()
    expect(screen.getByText(/Save to Test Stream/)).toBeInTheDocument()
    expect(screen.getByText('Copy')).toBeInTheDocument()

    // Mobile instructions should be hidden initially
    expect(screen.getByText('On mobile? Tap here for instructions')).toBeInTheDocument()
    expect(screen.queryByText(/Bookmark this page/)).not.toBeInTheDocument()

    // Click to show mobile instructions
    fireEvent.click(screen.getByText('On mobile? Tap here for instructions'))
    expect(screen.getByText(/Bookmark this page/)).toBeInTheDocument()
    expect(screen.getByText('Hide mobile instructions')).toBeInTheDocument()

    // Click to hide again
    fireEvent.click(screen.getByText('Hide mobile instructions'))
    expect(screen.queryByText(/Bookmark this page/)).not.toBeInTheDocument()
  })
})
