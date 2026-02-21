import React from 'react'
import { Outlet, useLocation, useNavigate, Link } from 'react-router'
import { HomeIcon, PlusIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import OfflineBanner from './OfflineBanner'
import { useSyncStatusOptional } from '../context/syncStatusContext'

const Layout: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const syncContext = useSyncStatusOptional()
  const globalSyncStatus = syncContext?.globalSyncStatus

  // Extract prefix from current path if in library context
  const prefixMatch = location.pathname.match(/^\/pk\/([^/]+)/)
  const prefix = prefixMatch ? prefixMatch[1] : null

  // Determine which bottom nav item is active
  const isHome = location.pathname === '/'
  const isNew = location.pathname === '/new' || location.pathname.endsWith('/new')
  const isSearch = location.pathname.endsWith('/search')

  // Don't show bottom nav on the editor page (it has its own toolbar)
  const isEditor = location.pathname.endsWith('/edit')

  // Show sync indicator dot
  const showSyncDot = globalSyncStatus ? globalSyncStatus.isSyncing && !globalSyncStatus.synced : false

  return (
    <div className="min-h-dvh bg-gray-50 flex flex-col">
      <OfflineBanner />
      <main className="flex-1 pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom navigation - hidden on desktop and in editor */}
      {!isEditor && (
        <nav className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 md:hidden z-50 pb-safe">
          <div className="flex items-center justify-around h-14">
            <Link
              to="/"
              className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
                isHome ? 'text-blue-600' : 'text-gray-500'
              }`}
            >
              <div className="relative">
                <HomeIcon className="w-6 h-6" />
                {showSyncDot && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-400 rounded-full" />
                )}
              </div>
              <span className="text-xs mt-0.5">Home</span>
            </Link>

            {prefix ? (
              <>
                <Link
                  to={`/pk/${prefix}/search`}
                  className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
                    isSearch ? 'text-blue-600' : 'text-gray-500'
                  }`}
                >
                  <MagnifyingGlassIcon className="w-6 h-6" />
                  <span className="text-xs mt-0.5">Search</span>
                </Link>

                <Link
                  to={`/pk/${prefix}/new`}
                  className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
                    isNew ? 'text-blue-600' : 'text-gray-500'
                  }`}
                >
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center -mt-3 shadow-lg">
                    <PlusIcon className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-xs mt-0.5 text-blue-600">New</span>
                </Link>
              </>
            ) : (
              <>
                <Link
                  to="/new"
                  className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
                    location.pathname === '/new' ? 'text-blue-600' : 'text-gray-500'
                  }`}
                >
                  <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center -mt-3 shadow-lg">
                    <PlusIcon className="w-6 h-6 text-white" />
                  </div>
                  <span className="text-xs mt-0.5 text-blue-600">New</span>
                </Link>
                <Link
                  to="/import"
                  className={`flex flex-col items-center justify-center w-full h-full transition-colors ${
                    location.pathname === '/import' ? 'text-blue-600' : 'text-gray-500'
                  }`}
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <span className="text-xs mt-0.5">Import</span>
                </Link>
              </>
            )}
          </div>
        </nav>
      )}
    </div>
  )
}

export default Layout
