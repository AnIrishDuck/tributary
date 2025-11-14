import { RouteObject } from 'react-router'
import NewStreamPage from './pages/NewStreamPage'
import EditorPage from './pages/EditorPage'
import BlockViewPage from './pages/BlockViewPage'
import HomePage from './pages/HomePage'
import BlockListPage from './pages/BlockListPage'
import React from 'react'

// Error components for routes
function NewDocumentError() {
  return React.createElement('div', null, 'ERROR: NEW DOCUMENT')
}

function DocumentError() {
  return React.createElement('div', null, 'ERROR: DOCUMENT')
}

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: HomePage,
  },
  {
    path: '/new',
    Component: NewStreamPage,
  },
  {
    path: '/pk/:prefix/new',
    Component: EditorPage,
    loader: async ({ params }) => {
      return { isNew: true }
    },
    ErrorBoundary: NewDocumentError
  },
  {
    path: '/pk/:prefix/',
    Component: BlockListPage,
    ErrorBoundary: DocumentError
  },
  {
    path: '/pk/:prefix/:slug/edit',
    Component: EditorPage,
    loader: async ({ params }) => {
      return { isNew: false }
    },
    ErrorBoundary: DocumentError
  },
  {
    path: '/pk/:prefix/:slug',
    Component: BlockViewPage,
    ErrorBoundary: DocumentError
  }
]
