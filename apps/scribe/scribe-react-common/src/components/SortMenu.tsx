import React, { useState, useRef, useEffect } from 'react'
import { BarsArrowDownIcon } from '@heroicons/react/24/outline'

export type SortType = 'alphabetical' | 'modified'
export type SortOrder = 'asc' | 'desc'

export interface SortOptions {
  type: SortType
  order: SortOrder
}

interface SortMenuProps {
  sort: SortOptions
  onSortChange: (sort: SortOptions) => void
}

export const SortMenu: React.FC<SortMenuProps> = ({ sort, onSortChange }) => {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const orderLabel = sort.type === 'alphabetical'
    ? (sort.order === 'asc' ? 'A to Z' : 'Z to A')
    : (sort.order === 'asc' ? 'Oldest to newest' : 'Newest to oldest')

  return (
    <div ref={menuRef} className="relative inline-flex">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Sort"
        className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
      >
        <BarsArrowDownIcon className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-2">
          {/* Sort type section */}
          <div className="px-3 py-1">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Sort by</span>
          </div>
          <button
            onClick={() => onSortChange({ ...sort, type: 'alphabetical', order: sort.type === 'alphabetical' ? sort.order : 'asc' })}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${sort.type === 'alphabetical' ? 'text-blue-600 font-medium' : 'text-gray-700'}`}
          >
            Alphabetical
          </button>
          <button
            onClick={() => onSortChange({ ...sort, type: 'modified', order: sort.type === 'modified' ? sort.order : 'desc' })}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${sort.type === 'modified' ? 'text-blue-600 font-medium' : 'text-gray-700'}`}
          >
            Modification time
          </button>

          {/* Divider */}
          <div className="border-t border-gray-100 my-1" />

          {/* Order section */}
          <div className="px-3 py-1">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Order</span>
          </div>
          {sort.type === 'alphabetical' ? (
            <>
              <button
                onClick={() => onSortChange({ ...sort, order: 'asc' })}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${sort.order === 'asc' ? 'text-blue-600 font-medium' : 'text-gray-700'}`}
              >
                A to Z
              </button>
              <button
                onClick={() => onSortChange({ ...sort, order: 'desc' })}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${sort.order === 'desc' ? 'text-blue-600 font-medium' : 'text-gray-700'}`}
              >
                Z to A
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => onSortChange({ ...sort, order: 'asc' })}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${sort.order === 'asc' ? 'text-blue-600 font-medium' : 'text-gray-700'}`}
              >
                Oldest to newest
              </button>
              <button
                onClick={() => onSortChange({ ...sort, order: 'desc' })}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${sort.order === 'desc' ? 'text-blue-600 font-medium' : 'text-gray-700'}`}
              >
                Newest to oldest
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
