import React from 'react'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

export interface ConflictWarningProps {
  onReload: () => void
  onDismiss: () => void
}

const ConflictWarning: React.FC<ConflictWarningProps> = ({ onReload, onDismiss }) => {
  return (
    <div className="bg-amber-50 border-b border-amber-200 py-2 px-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0" />
          <span className="text-amber-800 font-medium">
            This note has been updated elsewhere. You may want to save your work and reload.
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onReload}
            className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-md bg-amber-100 text-amber-800 hover:bg-amber-200 transition-colors"
          >
            Reload
          </button>
          <button
            onClick={onDismiss}
            className="inline-flex items-center px-3 py-1 text-xs font-medium rounded-md text-amber-600 hover:bg-amber-100 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConflictWarning
