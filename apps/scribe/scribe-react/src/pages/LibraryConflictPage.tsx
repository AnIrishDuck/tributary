import React from 'react'
import { Link } from 'react-router'
import { DocumentTextIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

interface ResolvedLibrary {
  libraryId: string
  libraryTitle: string | null
}

interface LibraryConflictPageProps {
  librarySlug: string
  matches: ResolvedLibrary[]
}

/**
 * Shown when a named route (#n/:librarySlug/...) matches more than one
 * library. Lists the conflicting libraries with links to their
 * authoritative pk-routes.
 */
const LibraryConflictPage: React.FC<LibraryConflictPageProps> = ({
  librarySlug,
  matches,
}) => {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors inline-flex items-center font-medium"
            >
              &larr; Home
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-xl shadow overflow-hidden p-6 md:p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <ExclamationTriangleIcon className="w-6 h-6 text-amber-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                Multiple libraries match "{librarySlug}"
              </h2>
              <p className="text-sm text-gray-500">
                Select the library you want to view:
              </p>
            </div>
          </div>

          <div className="space-y-3 mt-6">
            {matches.map(lib => {
              const displayId = `pk/${lib.libraryId.substring(0, 16)}...`
              return (
                <Link
                  key={lib.libraryId}
                  to={`/pk/${lib.libraryId}/`}
                  className="flex items-center p-4 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-lg transition-colors group"
                >
                  <div className="flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-lg bg-purple-100 text-purple-600 group-hover:bg-purple-200">
                    <DocumentTextIcon className="h-5 w-5" />
                  </div>
                  <div className="ml-4 flex-1">
                    <h4 className="text-base font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                      {lib.libraryTitle || 'Untitled Library'}
                    </h4>
                    <span className="text-xs text-gray-400 font-mono">
                      {displayId}
                    </span>
                  </div>
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-gray-400 group-hover:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default LibraryConflictPage
