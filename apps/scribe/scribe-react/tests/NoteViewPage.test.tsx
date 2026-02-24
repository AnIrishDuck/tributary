import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestClientWithStream, WithProviders } from './test-utils'
import { saveNote } from '../src/actions/saveNote'

describe('NoteViewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test the full workflow: create a note, then view it
  it('should display a note with rendered HTML content', async () => {
    // Create a test client with a stream
    const { client, stream, prefix } = await createTestClientWithStream()

    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]

    // Create a test note
    const testContent = '# Test Document\n\nThis is a **test** document with some *markdown*.'
    const { block, blockSlug } = await saveNote(stream, testContent)

    expect(blockSlug).toBeDefined()
    const slug = blockSlug!.slug

    // Now test viewing the note
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for the component to finish loading and show content
    await waitFor(() => {
      // Look for the edit button to confirm the page loaded successfully
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    }, { timeout: 3000 })

    // Check that the title is displayed (the title comes from markdown rendering, so only 1 instance)
    expect(screen.getAllByText('Test Document')).toHaveLength(1)

    // Check that the rendered HTML content is present by looking at the DOM directly
    // The markdown content should be rendered inside the prose div
    const contentDiv = document.querySelector('.prose')
    expect(contentDiv).toBeInTheDocument()

    // Check for the paragraph element containing our text
    const paragraphElement = contentDiv?.querySelector('p')
    expect(paragraphElement).toBeInTheDocument()
    expect(paragraphElement?.textContent).toContain('This is a')

    // Check for bold text (rendered from **test**)
    const boldElement = contentDiv?.querySelector('strong')
    expect(boldElement).toBeInTheDocument()
    expect(boldElement?.textContent).toBe('test')

    // Check for the new note button
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
  })

  it('should render NoteViewPage at /pk/:prefix/:slug route and load without errors', async () => {
    // This test verifies that the route /pk/:prefix/:slug actually renders and works
    // by creating a stream with a note, then directly rendering the NoteViewPage

    const { client, stream, prefix } = await createTestClientWithStream()

    // Extract just the base64 part for the route parameter
    const parts = prefix.split('/')
    const base64Part = parts[1]

    // Create a test note
    const testContent = '# Test Document\n\nTest content.'
    const { blockSlug } = await saveNote(stream, testContent)

    expect(blockSlug).toBeDefined()
    const slug = blockSlug!.slug

    // Create router and render the NoteViewPage at its route
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for the page to fully load - check for Edit button which means page loaded
    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Verify NO errors
    const errorEl = screen.queryByText(/Error|error/)
    expect(errorEl).toBeNull()
  })

  it('should render note normally when slug matches only a note (no regression)', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Create a note (no matching collection)
    const testContent = '# Unique Note\n\nThis note has a unique slug.'
    const { blockSlug } = await saveNote(stream, testContent)
    expect(blockSlug).toBeDefined()
    const slug = blockSlug!.slug

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show the note view with Edit button
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    }, { timeout: 5000 })

    // Should show the note content
    expect(screen.getByText('Unique Note')).toBeInTheDocument()
    expect(screen.getByText(/This note has a unique slug/)).toBeInTheDocument()
  })
})
