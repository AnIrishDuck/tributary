import React, { useState } from 'react'
import { Link } from 'react-router'
import { ClockIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import { Collection } from 'scribe-data'
import { Breadcrumbs } from './Breadcrumbs'
import { MoveModal } from './MoveModal'
import { SortMenu, SortOptions } from './SortMenu'
import { useRouteContext } from '../context/routeContext'

export interface SlugActionBarProps {
  ancestors: Collection[]
  prefix: string
  slugPath: string
  entityType: 'note' | 'collection' | 'image'
  entityId: string
  /** Whether to show the history link (notes and images, not collections) */
  showHistory?: boolean
  /** Whether to show move/rename (all entity types when not read-only) */
  readOnly?: boolean
  /** Callback after a successful move */
  onMoved: (newSlugPath: string) => void
  /** Current sort options (collection view only) */
  sort?: SortOptions
  /** Callback when sort changes (collection view only) */
  onSortChange?: (sort: SortOptions) => void
}

export const SlugActionBar: React.FC<SlugActionBarProps> = ({
  ancestors, prefix, slugPath, entityType, entityId,
  showHistory = false, readOnly = false, onMoved,
  sort, onSortChange
}) => {
  const [showMoveModal, setShowMoveModal] = useState(false)
  const routeCtx = useRouteContext()
  const trailingSlug = slugPath.split('/').pop()

  return (
    <>
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1 min-w-0">
          <Breadcrumbs
            ancestors={ancestors}
            prefix={prefix}
            allLinks={entityType !== 'collection'}
            trailingSlug={entityType !== 'collection' ? trailingSlug : undefined}
          />
        </div>
        {!readOnly && (
          <div className="flex-shrink-0 ml-2 inline-flex items-center gap-1">
            {sort && onSortChange && (
              <SortMenu sort={sort} onSortChange={onSortChange} />
            )}
            {showHistory && (
              <Link
                to={routeCtx.buildPath(`${slugPath}&history`)}
                className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
              >
                <ClockIcon className="w-4 h-4" />
              </Link>
            )}
            <button
              onClick={() => setShowMoveModal(true)}
              aria-label="Move"
              className="inline-flex items-center text-sm font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
            >
              <ArrowRightIcon className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      <MoveModal
        isOpen={showMoveModal}
        onClose={() => setShowMoveModal(false)}
        entityType={entityType}
        entityId={entityId}
        currentSlugPath={slugPath}
        prefix={prefix}
        onMoved={(newSlugPath) => {
          setShowMoveModal(false)
          onMoved(newSlugPath)
        }}
      />
    </>
  )
}
