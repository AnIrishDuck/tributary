import { RouteObject } from 'react-router'
import NewLibraryPage from './pages/NewLibraryPage'
import ImportLibraryPage from './pages/ImportLibraryPage'
import GrantWriteAccessPage from './pages/GrantWriteAccessPage'
import SlugViewPage from './pages/SlugViewPage'
import HomePage from './pages/HomePage'
import NoteListPage from 'scribe-react-listing/src/pages/NoteListPage'
import SearchPage from 'scribe-react-listing/src/pages/SearchPage'
import Layout from 'scribe-react-common/src/components/Layout'
import React from 'react'

// Error components for routes
function NoteError() {
  return React.createElement('div', null, 'ERROR: NOTE')
}

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
        Component: NewLibraryPage,
      },
      {
        path: '/import',
        Component: ImportLibraryPage,
      },
      {
        path: '/import/write/:writeKey',
        Component: ImportLibraryPage,
      },
      {
        // Route for granting write access via encoded private key
        path: '/pk/:prefix/grant/write/:encodedPrivateKey',
        Component: GrantWriteAccessPage,
        ErrorBoundary: NoteError
      },
      {
        path: '/pk/:prefix/',
        Component: NoteListPage,
        ErrorBoundary: NoteError
      },
      {
        path: '/pk/:prefix/search',
        Component: SearchPage,
        ErrorBoundary: NoteError
      },
      {
        // Handles all slug paths including:
        // - Note/collection viewing: /pk/:prefix/slug-path
        // - New note creation: /pk/:prefix/+note or /pk/:prefix/parent/+note
        // - New collection creation: /pk/:prefix/+collection or /pk/:prefix/parent/+collection
        // - Note editing: /pk/:prefix/slug-path&edit
        path: '/pk/:prefix/*',
        Component: SlugViewPage,
        ErrorBoundary: NoteError
      }
    ]
  }
]
