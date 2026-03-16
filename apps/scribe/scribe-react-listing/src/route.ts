import React from 'react'
import { RouteObject, Outlet, useParams } from 'react-router'
import { RouteContextProvider } from 'scribe-react-common/src/context/routeContext'
import NoteListPage from './pages/NoteListPage'
import SearchPage from './pages/SearchPage'
import SlugViewPage from './pages/SlugViewPage'
import Layout from 'scribe-react-common/src/components/Layout'

/**
 * Wraps pk-route pages in a RouteContextProvider so child components
 * can use useRouteContext(). Mirrors PkRouteWrapper in scribe-react.
 */
const PkRouteWrapper: React.FC = () => {
  const { prefix } = useParams<{ prefix: string }>()
  return React.createElement(
    RouteContextProvider,
    { paradigm: 'pk', prefix: prefix || '' },
    React.createElement(Outlet)
  )
}

export const routes: RouteObject[] = [
  {
    Component: Layout,
    children: [
      {
        path: '/pk/:prefix',
        Component: PkRouteWrapper,
        children: [
          {
            index: true,
            Component: NoteListPage,
          },
          {
            path: 'search',
            Component: SearchPage,
          },
          {
            path: '*',
            Component: SlugViewPage,
          }
        ]
      }
    ]
  }
]
