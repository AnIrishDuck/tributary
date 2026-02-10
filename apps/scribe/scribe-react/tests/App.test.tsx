import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../src/App'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'

describe('App', () => {
  it('should render the app with routing', () => {
    // Create a memory router for testing
    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })
    
    render(<RouterProvider router={router} />)
    
    // Should render the HomePage by default
    // Check for the empty state heading
    expect(screen.getByRole('heading', { name: /no streams yet/i })).toBeInTheDocument()
  })
})
