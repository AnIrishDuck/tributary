import React from 'react'

interface SlugLoadingPageProps {
  /** Optional sync progress info to show the user */
  syncProgress?: { currentIndex: number; finalIndex: number } | null
}

const SlugLoadingPage: React.FC<SlugLoadingPageProps> = ({ syncProgress }) => {
  const hasSyncInfo = syncProgress && syncProgress.finalIndex > 0

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-4">
      <div className="text-center">
        <div className="mx-auto w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-2"></div>
        {hasSyncInfo ? (
          <>
            <p className="text-sm text-gray-600">Syncing library...</p>
            <p className="text-xs text-gray-400 mt-1">
              {syncProgress.currentIndex} / {syncProgress.finalIndex}
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-600">Loading...</p>
        )}
      </div>
    </div>
  )
}

export default SlugLoadingPage
