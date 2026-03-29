import React from 'react'
import { Squares2X2Icon, ListBulletIcon } from '@heroicons/react/24/outline'

export type ViewMode = 'card' | 'list'

interface ViewModeToggleProps {
  mode: ViewMode
  onModeChange: (mode: ViewMode) => void
}

export const ViewModeToggle: React.FC<ViewModeToggleProps> = ({ mode, onModeChange }) => {
  const next = mode === 'card' ? 'list' : 'card'
  const label = mode === 'card' ? 'Switch to list view' : 'Switch to card view'

  return (
    <button
      onClick={() => onModeChange(next)}
      aria-label={label}
      className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
    >
      {mode === 'card' ? (
        <ListBulletIcon className="w-4 h-4" />
      ) : (
        <Squares2X2Icon className="w-4 h-4" />
      )}
    </button>
  )
}
