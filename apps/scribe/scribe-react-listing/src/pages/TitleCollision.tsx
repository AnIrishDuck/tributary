import React from 'react'
import { useNavigate, Link } from 'react-router'
import { ArrowLeftIcon, DocumentTextIcon, FolderIcon, PhotoIcon } from '@heroicons/react/24/outline'
import { useRouteContext } from 'scribe-react-common/src/context/routeContext'

interface TitleLookupResult {
  title: string
  entity_type: string
  entity_uuid: string
  slug_path: string
}

interface TitleCollisionProps {
  title: string
  results: TitleLookupResult[]
  prefix: string
}

const TitleCollision: React.FC<TitleCollisionProps> = ({ title, results, prefix }) => {
  const navigate = useNavigate()
  const routeCtx = useRouteContext()

  const handleBack = () => {
    navigate(routeCtx.buildPath())
  }

  const iconForType = (entityType: string) => {
    if (entityType === 'collection') return <FolderIcon className="w-5 h-5 text-amber-500 flex-shrink-0" />
    if (entityType === 'image') return <PhotoIcon className="w-5 h-5 text-blue-400 flex-shrink-0" />
    return <DocumentTextIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
  }

  const labelForType = (entityType: string) => {
    if (entityType === 'collection') return 'Collection'
    if (entityType === 'image') return 'Image'
    return 'Note'
  }

  if (results.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="bg-white border-b border-gray-200 py-3 shadow-sm sticky top-0 z-40">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-3">
              <button
                onClick={handleBack}
                className="text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors inline-flex items-center font-medium"
              >
                <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
                Back
              </button>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="bg-white rounded-xl shadow overflow-hidden p-6 md:p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              No items titled &ldquo;{title}&rdquo;
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              No notes or collections with this title were found in this library.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors inline-flex items-center font-medium"
            >
              <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
              Back
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-xl shadow overflow-hidden p-6 md:p-8">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            Multiple items titled &ldquo;{title}&rdquo;
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            Select the item you want to view:
          </p>

          <div className="space-y-3">
            {results.map((result) => (
              <Link
                key={`${result.entity_type}-${result.entity_uuid}`}
                to={routeCtx.buildPath(result.slug_path)}
                className="block bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-lg p-4 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {iconForType(result.entity_type)}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{result.title}</p>
                    <p className="text-xs text-gray-500 font-mono truncate">{result.slug_path}</p>
                    <p className="text-xs text-gray-400">{labelForType(result.entity_type)}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default TitleCollision
