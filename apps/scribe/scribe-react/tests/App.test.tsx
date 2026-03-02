import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { createTestTributaryClient } from 'scribe-react-common/src/context/tributaryContext'
import { WithProviders } from './test-utils'

describe('App', () => {
  it('should render the app with routing', async () => {
    const { client } = createTestTributaryClient()

    const router = createMemoryRouter(routes, {
      initialEntries: ['/']
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Wait for sync to complete and page to render
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /no libraries yet/i })).toBeInTheDocument()
    }, { timeout: 3000 })
  })
})
