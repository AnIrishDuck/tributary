import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import React from 'react'
import PkRouteWrapper from '../src/components/PkRouteWrapper'
import { useRouteContext } from 'scribe-react-common/src/context/routeContext'

/** Test child that renders the route context values for assertions */
function RouteContextDisplay() {
  const ctx = useRouteContext()
  return (
    <div>
      <span data-testid="paradigm">{ctx.paradigm}</span>
      <span data-testid="prefix">{ctx.prefix}</span>
      <span data-testid="root-path">{ctx.buildPath()}</span>
      <span data-testid="slug-path">{ctx.buildPath('my-note')}</span>
      <span data-testid="nested-path">{ctx.buildPath('collection/my-note')}</span>
    </div>
  )
}

describe('PkRouteWrapper', () => {
  const testPrefix = '_ip1xGnAiIyjoI2RRX5xmAVei607S-s3rvTmEgFQ-k0'

  function renderAtPkRoute(prefix: string) {
    const routes = [
      {
        path: '/pk/:prefix',
        Component: PkRouteWrapper,
        children: [
          {
            index: true,
            Component: RouteContextDisplay,
          },
        ],
      },
    ]
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${prefix}/`],
    })
    return render(<RouterProvider router={router} />)
  }

  it('should provide pk paradigm to child routes', async () => {
    renderAtPkRoute(testPrefix)
    await waitFor(() => {
      expect(screen.getByTestId('paradigm')).toHaveTextContent('pk')
    })
  })

  it('should provide the prefix from URL params', async () => {
    renderAtPkRoute(testPrefix)
    await waitFor(() => {
      expect(screen.getByTestId('prefix')).toHaveTextContent(testPrefix)
    })
  })

  it('should build root path with pk prefix', async () => {
    renderAtPkRoute(testPrefix)
    await waitFor(() => {
      expect(screen.getByTestId('root-path')).toHaveTextContent(`/pk/${testPrefix}/`)
    })
  })

  it('should build slug path with pk prefix', async () => {
    renderAtPkRoute(testPrefix)
    await waitFor(() => {
      expect(screen.getByTestId('slug-path')).toHaveTextContent(`/pk/${testPrefix}/my-note`)
    })
  })

  it('should build nested slug path with pk prefix', async () => {
    renderAtPkRoute(testPrefix)
    await waitFor(() => {
      expect(screen.getByTestId('nested-path')).toHaveTextContent(`/pk/${testPrefix}/collection/my-note`)
    })
  })
})
