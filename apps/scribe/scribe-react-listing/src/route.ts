import { RouteObject } from 'react-router'
import NoteListPage from './pages/NoteListPage'
import SearchPage from './pages/SearchPage'
import SlugViewPage from './pages/SlugViewPage'
import Layout from 'scribe-react-common/src/components/Layout'

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
        Component: SlugViewPage,
      }
    ]
  }
]
