import React from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon, FolderIcon } from '@heroicons/react/24/outline'

export interface MissingParentPageProps {
  prefix: string
  slugPath: string
  resolvedSegments: string[]
  missingSegments: string[]
}

const MissingParentPage: React.FC<MissingParentPageProps> = ({
  prefix, slugPath, resolvedSegments, missingSegments
}) => {
  const navigate = useNavigate()

  const handleBack = () => {
    if (resolvedSegments.length > 0) {
      navigate(`/pk/${prefix}/${resolvedSegments.join('/')}`)
    } else {
      navigate(`/pk/${prefix}/`)
    }
  }

  // The missing parents are all missing segments except the last (the target)
  const missingParents = missingSegments.slice(0, -1)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <button
              onClick={handleBack}
              className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              <ArrowLeftIcon className="w-4 h-4 md:mr-1" />
              <span className="hidden md:inline">Back</span>
            </button>
            <h1 className="text-xl font-bold text-gray-900">Missing Collections</h1>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8">
          <div className="text-center mb-6">
            <div className="mx-auto w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mb-4">
              <FolderIcon className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">
              Parent collections need to be created
            </h2>
            <p className="text-sm text-gray-600">
              The path <span className="font-mono text-gray-800 bg-gray-100 px-1.5 py-0.5 rounded">{slugPath}</span> requires
              the following collections to exist first:
            </p>
          </div>

          <div className="space-y-3 mt-6">
            {missingSegments.map((segment, index) => {
              const isParent = index < missingParents.length
              const fullPath = [...resolvedSegments, ...missingSegments.slice(0, index + 1)].join('/')

              return (
                <div
                  key={fullPath}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
                    isParent
                      ? 'border-amber-200 bg-amber-50'
                      : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <FolderIcon className={`w-5 h-5 flex-shrink-0 ${
                    isParent ? 'text-amber-600' : 'text-gray-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-sm text-gray-800">{fullPath}</span>
                  </div>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    isParent
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-gray-200 text-gray-600'
                  }`}>
                    {isParent ? 'missing collection' : 'target'}
                  </span>
                </div>
              )
            })}
          </div>

          <p className="text-sm text-gray-500 mt-6 text-center">
            Create the missing parent collection{missingParents.length > 1 ? 's' : ''} before
            adding content at this path.
          </p>
        </div>
      </div>
    </div>
  )
}

export default MissingParentPage
