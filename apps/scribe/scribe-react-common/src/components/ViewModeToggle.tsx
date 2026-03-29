import React from 'react'
import { Squares2X2Icon, ListBulletIcon } from '@heroicons/react/24/outline'

export type ViewMode = 'card' | 'list'

interface ViewModeToggleProps {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({ mode, onModeChange }) => {
  return (
    <div className="inline-flex items-center rounded-lg border border-gray-200">
      <button
        onClick={() => onModeChange('card')}
        aria-label="Card view"
        className={`inline-flex items-center px-2 py-1 rounded-l-lg transition-colors ${
          mode === 'card'
            ? 'bg-blue-50 text-blue-600'
            : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
        }`}
      >
        <Squares2X2Icon className="w-4 h-4" />
      </button>
      <button
        onClick={() => onModeChange('list')}
        aria-label="List view"
        className={`inline-flex items-center px-2 py-1 rounded-r-lg transition-colors ${
          mode === 'list'
            ? 'bg-blue-50 text-blue-600'
            : 'text-gray-500 hover:text-blue-600 hover:bg-blue-50'
        }`}
      >
        <ListBulletIcon className="w-4 h-4" />
      </button>
    </div>
  )
}
