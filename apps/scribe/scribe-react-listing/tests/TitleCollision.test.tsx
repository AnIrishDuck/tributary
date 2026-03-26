import React from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import TitleCollision from '../src/pages/TitleCollision'
import { RouteContextProvider } from 'scribe-react-common/src/context/routeContext'

function renderWithRouter(ui: React.ReactElement, initialEntry: string = '/pk/test-prefix/&titled') {
  const router = createMemoryRouter(
    [{ path: '/pk/:prefix/*', element: ui }],
    { initialEntries: [initialEntry] }
  )
  return render(<RouterProvider router={router} />)
}

function Wrapped(props: React.ComponentProps<typeof TitleCollision>) {
  return (
    <RouteContextProvider paradigm="pk" prefix="test-prefix">
      <TitleCollision {...props} />
    </RouteContextProvider>
  )
}

describe('TitleCollision', () => {
  it('should show "not found" message when results are empty', () => {
    renderWithRouter(<Wrapped title="Missing Note" results={[]} prefix="test-prefix" />)

    expect(screen.getByText(/No items titled/)).toBeInTheDocument()
    expect(screen.getByText(/Missing Note/)).toBeInTheDocument()
    expect(screen.getByText(/No notes or collections with this title/)).toBeInTheDocument()
  })

  it('should show disambiguation header for multiple results', () => {
    const results = [
      { title: 'Pasta', entity_type: 'note', entity_uuid: 'uuid-1', slug_path: 'pasta' },
      { title: 'Pasta', entity_type: 'note', entity_uuid: 'uuid-2', slug_path: 'italian/pasta' },
    ]
    renderWithRouter(<Wrapped title="Pasta" results={results} prefix="test-prefix" />)

    expect(screen.getByText(/Multiple items titled/)).toBeInTheDocument()
    expect(screen.getByText(/Multiple items titled/).textContent).toContain('Pasta')
    expect(screen.getByText(/Select the item you want to view/)).toBeInTheDocument()
  })

  it('should render each result with slug path and type label', () => {
    const results = [
      { title: 'Pasta', entity_type: 'note', entity_uuid: 'uuid-1', slug_path: 'pasta' },
      { title: 'Pasta', entity_type: 'collection', entity_uuid: 'uuid-2', slug_path: 'italian/pasta' },
    ]
    renderWithRouter(<Wrapped title="Pasta" results={results} prefix="test-prefix" />)

    expect(screen.getByText('pasta')).toBeInTheDocument()
    expect(screen.getByText('italian/pasta')).toBeInTheDocument()
    expect(screen.getByText('Note')).toBeInTheDocument()
    expect(screen.getByText('Collection')).toBeInTheDocument()
  })

  it('should render links to each result slug path', () => {
    const results = [
      { title: 'Pasta', entity_type: 'note', entity_uuid: 'uuid-1', slug_path: 'pasta' },
      { title: 'Pasta', entity_type: 'note', entity_uuid: 'uuid-2', slug_path: 'italian/pasta' },
    ]
    renderWithRouter(<Wrapped title="Pasta" results={results} prefix="test-prefix" />)

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', '/pk/test-prefix/pasta')
    expect(links[1]).toHaveAttribute('href', '/pk/test-prefix/italian/pasta')
  })

  it('should show correct type label for image results', () => {
    const results = [
      { title: 'Sunset', entity_type: 'image', entity_uuid: 'uuid-1', slug_path: 'photos/sunset' },
    ]
    renderWithRouter(<Wrapped title="Sunset" results={results} prefix="test-prefix" />)

    expect(screen.getByText('Image')).toBeInTheDocument()
    expect(screen.getByText('photos/sunset')).toBeInTheDocument()
  })

  it('should render a Back button', () => {
    renderWithRouter(<Wrapped title="Test" results={[]} prefix="test-prefix" />)

    expect(screen.getByText('Back')).toBeInTheDocument()
  })
})
