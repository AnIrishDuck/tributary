import React from 'react'
import { Link } from 'react-router'
import { Collection, titleToSlug } from 'scribe-data'

interface BreadcrumbsProps {
  ancestors: Collection[]
  prefix: string
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ ancestors, prefix }) => {
  if (ancestors.length === 0) return null

  // Build cumulative slug paths for each non-root ancestor
  const nonRootAncestors = ancestors.filter(a => a.parent_collection_uuid !== null)

  return (
    <nav className="flex items-center text-sm text-gray-500 mb-4 flex-wrap gap-1">
      <Link
        to={`/pk/${prefix}/`}
        className="hover:text-blue-600 transition-colors"
      >
        Library
      </Link>
      {nonRootAncestors.map((ancestor, index) => {
        // Build cumulative path from first non-root ancestor up to this one
        const cumulativePath = nonRootAncestors
          .slice(0, index + 1)
          .map(a => titleToSlug(a.title))
          .join('/')

        const isLast = index === nonRootAncestors.length - 1

        return (
          <React.Fragment key={ancestor.collection_uuid}>
            <span className="mx-1 text-gray-400">/</span>
            {isLast ? (
              <span className="text-gray-900 font-medium">{ancestor.title}</span>
            ) : (
              <Link
                to={`/pk/${prefix}/${cumulativePath}`}
                className="hover:text-blue-600 transition-colors"
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
