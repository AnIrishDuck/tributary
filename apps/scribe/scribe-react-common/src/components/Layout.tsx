import React, { useState, useRef, useEffect } from 'react'
import { Outlet, useLocation, Link } from 'react-router'
import { ArrowRightStartOnRectangleIcon, TrashIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import OfflineBanner from './OfflineBanner'
import { useTributary } from '../context/tributaryContext'
import { BottomNavProvider, FloatingAction } from '../context/bottomNavContext'
import { useDocumentTitle } from '../hooks/useDocumentTitle'

const Layout: React.FC = () => {
  const location = useLocation()
  const { logout, clearAccount } = useTributary()
  const [loggingOut, setLoggingOut] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useDocumentTitle()

  const handleLogout = async () => {
    if (!logout || loggingOut) return
    setMenuOpen(false)
    setLoggingOut(true)
    await logout()
  }

  const handleClear = async () => {
    if (!clearAccount || clearing) return
    setMenuOpen(false)
    setClearing(true)
    await clearAccount()
  }

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [menuOpen])

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
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(prev => !prev)}
                disabled={loggingOut}
                className="inline-flex items-center p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                title="Account menu"
              >
                <UserCircleIcon className="w-5 h-5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  <Link
                    to="/account"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <UserCircleIcon className="w-4 h-4" />
                    Account
                  </Link>
                  <button
                    onClick={handleLogout}
                    disabled={loggingOut}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    <ArrowRightStartOnRectangleIcon className="w-4 h-4" />
                    {loggingOut ? 'Signing out...' : 'Sign out'}
                  </button>
                  {clearAccount && (
                    <button
                      onClick={handleClear}
                      disabled={clearing}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
                    >
                      <TrashIcon className="w-4 h-4" />
                      {clearing ? 'Clearing...' : 'Clear'}
                    </button>
                  )}
                </div>
              )}
            </div>
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
