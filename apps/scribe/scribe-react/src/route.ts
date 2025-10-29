import { RouteObject } from 'react-router'
import NewStreamPage from './pages/NewStreamPage'
import EditorPage from './pages/EditorPage'
import HomePage from './pages/HomePage'
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
    path: '/pk/:prefix/:slug',
    Component: EditorPage,
    loader: async ({ params }) => {
      return { isNew: false }
    },
    ErrorBoundary: DocumentError
  }
]
