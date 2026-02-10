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
    // Text is split across multiple span elements, so use a function matcher
    expect(screen.getByText((content, element) => {
      return element?.tagName === 'H1' && element.textContent === 'Scribe Encrypted Document Editor'
    })).toBeInTheDocument()
  })
})
