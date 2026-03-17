import React, { useState } from 'react'
import { Outlet, useLocation, Link } from 'react-router'
import { ArrowRightStartOnRectangleIcon } from '@heroicons/react/24/outline'
import OfflineBanner from './OfflineBanner'
import { useTributary } from '../context/tributaryContext'
import { BottomNavProvider, FloatingAction } from '../context/bottomNavContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const Layout: React.FC = () => {
  const location = useLocation()
  const { logout } = useTributary()
  const [loggingOut, setLoggingOut] = useState(false)

  useDocumentTitle()

  const handleLogout = async () => {
    if (!logout || loggingOut) return
    setLoggingOut(true)
    await logout()
  }

  const isHome = location.pathname === '/'
  // Detect editor pages: &edit, +note, +draft paths
  const pathSegments = location.pathname.split('/')
  const lastSegment = pathSegments[pathSegments.length - 1] || ''
  const isEditorPage = lastSegment.endsWith('&edit') || lastSegment === '+note' || pathSegments.includes('+draft')

  // Allow child pages to override the floating action button
  const [floatingAction, setFloatingAction] = useState<FloatingAction | null>(null)
  const bottomNavCtx = React.useMemo(() => ({ setFloatingAction }), [])

  return (
    <BottomNavProvider value={bottomNavCtx}>
    <div className={`bg-gray-50 flex flex-col ${isEditorPage ? 'h-dvh overflow-hidden' : 'min-h-dvh'}`}>
      <OfflineBanner />
      {logout && isHome && (
        <div className="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 flex justify-end h-10 items-center">
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
              title="Sign out"
            >
              <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
              <span>{loggingOut ? 'Signing out...' : 'Sign out'}</span>
            </button>
          </div>
        </div>
      )}
      <main className={`flex-1 ${isEditorPage ? 'min-h-0 flex flex-col' : ''}`}>
        <Outlet />
      </main>

      {/* Standalone Floating Action Button */}
      {floatingAction && (
        <Link
          to={floatingAction.to}
          className="fixed z-50 right-4 bottom-4 md:right-8 md:bottom-8 flex items-center justify-center w-14 h-14 bg-blue-600 hover:bg-blue-700 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 text-white"
          aria-label={floatingAction.label}
        >
          <floatingAction.icon className="w-6 h-6" />
        </Link>
      )}
    </div>
    </BottomNavProvider>
  )
}

export default Layout
