import React from 'react'
import { SignalSlashIcon } from '@heroicons/react/24/outline'
import { useOnlineStatus } from '../hooks/useOnlineStatus'

const OfflineBanner: React.FC = () => {
  const isOnline = useOnlineStatus()

  if (isOnline) return null

  return (
    <div className="bg-amber-50 border-b border-amber-200 py-2 px-4">
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-sm">
        <SignalSlashIcon className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <span className="text-amber-800 font-medium">
          You're offline
        </span>
        <span className="text-amber-600 hidden sm:inline">
          — changes will sync when you reconnect
        </span>
      </div>
    </div>
  )
}

export default OfflineBanner
