import { RouteObject } from 'react-router'
import NewLibraryPage from './pages/NewLibraryPage'
import ImportLibraryPage from './pages/ImportLibraryPage'
import GrantWriteAccessPage from './pages/GrantWriteAccessPage'
import EditorPage from './pages/EditorPage'
import NoteViewPage from './pages/NoteViewPage'
import HomePage from './pages/HomePage'
import NoteListPage from './pages/NoteListPage'
import SearchPage from './pages/SearchPage'
import Layout from './components/Layout'
import React from 'react'

// Error components for routes
function NewNoteError() {
  return React.createElement('div', null, 'ERROR: NEW NOTE')
}

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
        path: '/pk/:prefix/new',
        Component: EditorPage,
        ErrorBoundary: NewNoteError
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
        path: '/pk/:prefix/:slug/:uuid/edit',
        Component: EditorPage,
        ErrorBoundary: NoteError
      },
      {
        path: '/pk/:prefix/:slug/:uuid',
        Component: NoteViewPage,
        ErrorBoundary: NoteError
      },
      {
        path: '/pk/:prefix/:slug/edit',
        Component: EditorPage,
        ErrorBoundary: NoteError
      },
      {
        path: '/pk/:prefix/:slug',
        Component: NoteViewPage,
        ErrorBoundary: NoteError
      }
    ]
  }
]
