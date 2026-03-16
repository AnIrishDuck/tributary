import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import React from 'react'
import LibraryConflictPage from '../src/pages/LibraryConflictPage'

function renderWithRouter(element: React.ReactElement) {
  const routes = [
    {
      path: '/',
      element,
    },
    {
      path: '/pk/:prefix/*',
      element: <div>PK Route</div>,
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  return render(<RouterProvider router={router} />)
}

describe('LibraryConflictPage', () => {
  const matches = [
    { libraryId: 'abc123def456ghi789jkl012mno345pq', libraryTitle: 'My Recipes' },
    { libraryId: 'xyz789uvw456rst123opq012lmn345ab', libraryTitle: 'My Recipes' },
  ]

  it('should display the library slug in the heading', () => {
    renderWithRouter(
      <LibraryConflictPage librarySlug="my-recipes" matches={matches} />
    )
    expect(screen.getByText(/Multiple libraries match "my-recipes"/)).toBeInTheDocument()
  })

  it('should display all matching libraries', () => {
    renderWithRouter(
      <LibraryConflictPage librarySlug="my-recipes" matches={matches} />
    )
    // Both library titles should appear
    const titles = screen.getAllByText('My Recipes')
    expect(titles).toHaveLength(2)
  })

  it('should show truncated pk identifiers', () => {
    renderWithRouter(
      <LibraryConflictPage librarySlug="my-recipes" matches={matches} />
    )
    expect(screen.getByText('pk/abc123def456ghi7...')).toBeInTheDocument()
    expect(screen.getByText('pk/xyz789uvw456rst1...')).toBeInTheDocument()
  })

  it('should link to authoritative pk routes', () => {
    renderWithRouter(
      <LibraryConflictPage librarySlug="my-recipes" matches={matches} />
    )
    const links = screen.getAllByRole('link').filter(link =>
      link.getAttribute('href')?.includes('/pk/')
    )
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', `/pk/${matches[0].libraryId}/`)
    expect(links[1]).toHaveAttribute('href', `/pk/${matches[1].libraryId}/`)
  })

  it('should display "Untitled Library" for matches without titles', () => {
    const matchesNoTitle = [
      { libraryId: 'abc123def456ghi789jkl012mno345pq', libraryTitle: null },
      { libraryId: 'xyz789uvw456rst123opq012lmn345ab', libraryTitle: 'My Recipes' },
    ]
    renderWithRouter(
      <LibraryConflictPage librarySlug="my-recipes" matches={matchesNoTitle} />
    )
    expect(screen.getByText('Untitled Library')).toBeInTheDocument()
    expect(screen.getByText('My Recipes')).toBeInTheDocument()
  })

  it('should show a home link', () => {
    renderWithRouter(
      <LibraryConflictPage librarySlug="my-recipes" matches={matches} />
    )
    const homeLink = screen.getByRole('link', { name: /home/i })
    expect(homeLink).toHaveAttribute('href', '/')
  })
})
