import { RouteObject } from 'react-router'
import NoteListPage from './pages/NoteListPage'
import SearchPage from './pages/SearchPage'
import Layout from 'scribe-react-common/src/components/Layout'
import React from 'react'

// Stub components for routes handled by other packages
function SlugViewStub() {
  return React.createElement('div', null, 'SLUG_VIEW_STUB')
}

export const routes: RouteObject[] = [
  {
    Component: Layout,
    children: [
      {
        path: '/pk/:prefix/',
        Component: NoteListPage,
      },
      {
        path: '/pk/:prefix/search',
        Component: SearchPage,
      },
      {
        path: '/pk/:prefix/*',
        Component: SlugViewStub,
      }
    ]
  }
]
