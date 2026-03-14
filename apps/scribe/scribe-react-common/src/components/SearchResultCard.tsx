import React from 'react'
import { Link } from 'react-router'
import { DocumentTextIcon } from '@heroicons/react/24/outline'
import { SearchResult, slugToTitle } from 'scribe-data'
import { useRouteContext } from '../context/routeContext'

interface SearchResultCardProps {
  /**
   * The search result to display
   */
  result: SearchResult
  
  /**
   * The stream prefix for generating the link
   */
  prefix: string
  
  /**
   * Optional callback when result is clicked
   */
  onClick?: () => void
}

export const SearchResultCard: React.FC<SearchResultCardProps> = ({
  result,
  prefix,
  onClick
}) => {
  const routeCtx = useRouteContext()
  // Generate the link to the note
  // If no slug, use the block UUID as fallback
  const notePath = result.slug
    ? routeCtx.buildPath(result.slug)
    : routeCtx.buildPath(`block/${result.block_uuid}`)

  return (
    <Link
      to={notePath}
      onClick={onClick}
      className="block group"
    >
      <div className="bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-md transition-all duration-200">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <div className="h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
              <DocumentTextIcon className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-gray-900 group-hover:text-blue-600 transition-colors mb-1">
              {result.title && result.title !== result.block_uuid ? slugToTitle(result.title) : 'Untitled Note'}
            </h3>
            
            {result.snippet && (
              <p 
                className="text-sm text-gray-600 line-clamp-2"
                dangerouslySetInnerHTML={{ __html: result.snippet }}
              />
            )}
            
            {result.slug && (
              <div className="mt-2">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                  {result.slug}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </Link>
  )
}
