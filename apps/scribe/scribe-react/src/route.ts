import { RouteObject, redirect } from 'react-router'
import GrantWriteAccessPage from './pages/GrantWriteAccessPage'
import SlugViewPage from 'scribe-react-listing/src/pages/SlugViewPage'
import HomePage from './pages/HomePage'
import NoteListPage from 'scribe-react-listing/src/pages/NoteListPage'
import SearchPage from 'scribe-react-listing/src/pages/SearchPage'
import Layout from 'scribe-react-common/src/components/Layout'
import PkRouteWrapper from './components/PkRouteWrapper'
import NamedRouteResolver from './components/NamedRouteResolver'
import React from 'react'

// Error components for routes
function NoteError() {
  return React.createElement('div', null, 'ERROR: NOTE')
}

// Shared library routes used by both pk and named paradigms
export const libraryRoutes: RouteObject[] = [
  {
    index: true,
    Component: NoteListPage,
    ErrorBoundary: NoteError
  },
  {
    path: 'search',
    Component: SearchPage,
    ErrorBoundary: NoteError
  },
  {
    // Handles all slug paths including:
    // - Note/collection viewing: slug-path
    // - New note creation: +note or parent/+note
    // - New collection creation: +collection or parent/+collection
    // - Note editing: slug-path&edit
    path: '*',
    Component: SlugViewPage,
    ErrorBoundary: NoteError
  }
]

export const routes: RouteObject[] = [
  {
    Component: Layout,
    children: [
      {
        path: '/',
        Component: HomePage,
      },
      {
        path: '/new',
        loader: () => redirect('/?create'),
      },
      {
        path: '/import',
        loader: () => redirect('/?import'),
      },
      {
        path: '/import/write/:writeKey',
        loader: ({ params }) => redirect(`/?import&writeKey=${params.writeKey}`),
      },
      {
        // Route for granting write access via encoded private key
        path: '/pk/:prefix/grant/write/:encodedPrivateKey',
        Component: GrantWriteAccessPage,
        ErrorBoundary: NoteError
      },
      // Public-key routes: #pk/:prefix/...
      {
        path: '/pk/:prefix',
        Component: PkRouteWrapper,
        children: libraryRoutes,
      },
      // Named routes: #n/:librarySlug/...
      {
        path: '/n/:librarySlug',
        Component: NamedRouteResolver,
        children: libraryRoutes,
      },
    ]
  }
]
