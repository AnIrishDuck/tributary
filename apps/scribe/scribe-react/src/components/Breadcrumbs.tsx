import React, { useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react'
import { Link } from 'react-router'
import { Collection, titleToSlug } from 'scribe-data'

interface BreadcrumbsProps {
  ancestors: Collection[]
  prefix: string
  /** When true, all items (including the last) are rendered as links. Used for note views where the note title is shown separately. */
  allLinks?: boolean
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ ancestors, prefix, allLinks }) => {
  if (ancestors.length === 0) return null

  // Build cumulative slug paths for each non-root ancestor
  const nonRootAncestors = ancestors.filter(a => a.parent_collection_uuid !== null)

  const navRef = useRef<HTMLElement>(null)
  const [hiddenCount, setHiddenCount] = useState(0)

  // Stable key for ancestor identity to detect changes
  const ancestorKey = nonRootAncestors.map(a => a.collection_uuid).join(',')

  // Reset hidden count when ancestors change
  useEffect(() => {
    setHiddenCount(0)
  }, [ancestorKey])

  // Progressively hide items from the front until content fits.
  // useLayoutEffect runs synchronously before paint, so the cascade
  // (check -> increment -> re-render -> check) is invisible to the user.
  useLayoutEffect(() => {
    if (!navRef.current) return
    const el = navRef.current
    // Keep at least the most proximate ancestor visible
    if (el.scrollWidth > el.clientWidth && hiddenCount < nonRootAncestors.length) {
      setHiddenCount(prev => prev + 1)
    }
  }, [hiddenCount, ancestorKey, nonRootAncestors.length])

  // Re-measure on container resize
  const resetHiddenCount = useCallback(() => setHiddenCount(0), [])
  useEffect(() => {
    if (!navRef.current || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resetHiddenCount)
    observer.observe(navRef.current)
    return () => observer.disconnect()
  }, [resetHiddenCount])

  const visibleAncestors = nonRootAncestors.slice(hiddenCount)
  const showEllipsis = hiddenCount > 0
  // If all non-root ancestors are hidden, also hide the Library link
  const showLibrary = hiddenCount < nonRootAncestors.length || nonRootAncestors.length === 0

  return (
    <nav ref={navRef} className="flex items-center text-sm text-gray-500 mb-4 overflow-hidden whitespace-nowrap">
      {showLibrary && (
        <Link
          to={`/pk/${prefix}/`}
          className="hover:text-blue-600 transition-colors flex-shrink-0"
        >
          Library
        </Link>
      )}
      {showEllipsis && (
        <>
          {showLibrary && <span className="mx-1 text-gray-400 flex-shrink-0">/</span>}
          <span className="text-gray-400 flex-shrink-0">&hellip;</span>
        </>
      )}
      {visibleAncestors.map((ancestor, visIndex) => {
        // Map back to the original index for cumulative path building
        const originalIndex = hiddenCount + visIndex
        const cumulativePath = nonRootAncestors
          .slice(0, originalIndex + 1)
          .map(a => titleToSlug(a.title))
          .join('/')

        const isLast = originalIndex === nonRootAncestors.length - 1

        return (
          <React.Fragment key={ancestor.collection_uuid}>
            <span className="mx-1 text-gray-400 flex-shrink-0">/</span>
            {isLast && !allLinks ? (
              <span className="text-gray-900 font-medium flex-shrink-0">{ancestor.title}</span>
            ) : (
              <Link
                to={`/pk/${prefix}/${cumulativePath}`}
                className="hover:text-blue-600 transition-colors flex-shrink-0"
              >
                {ancestor.title}
              </Link>
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}
