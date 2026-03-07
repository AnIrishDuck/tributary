import React from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon, DocumentTextIcon, FolderPlusIcon } from '@heroicons/react/24/outline'

export interface MissingSlugPageProps {
  prefix: string
  slugPath: string
}

const MissingSlugPage: React.FC<MissingSlugPageProps> = ({ prefix, slugPath }) => {
  const navigate = useNavigate()

  const handleBack = () => {
    const segments = slugPath.split('/').filter(Boolean)
    if (segments.length > 1) {
      navigate(`/pk/${prefix}/${segments.slice(0, -1).join('/')}`)
    } else {
      navigate(`/pk/${prefix}/`)
    }
  }

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
            <h1 className="text-xl font-bold text-gray-900">
              <span className="font-mono text-gray-600">{slugPath}</span>
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-2xl shadow-lg p-6 md:p-8">
          <div className="text-center mb-8">
            <p className="text-gray-600">
              Nothing exists at this path yet. What would you like to create?
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => navigate(`/pk/${prefix}/${slugPath}+note`)}
              className="group flex flex-col items-center gap-3 px-6 py-8 rounded-xl border-2 border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all"
            >
              <div className="h-14 w-14 rounded-full bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                <DocumentTextIcon className="w-7 h-7 text-blue-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                  New Note
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Create a note at this path
                </p>
              </div>
            </button>

            <button
              onClick={() => navigate(`/pk/${prefix}/${slugPath}+collection`)}
              className="group flex flex-col items-center gap-3 px-6 py-8 rounded-xl border-2 border-gray-200 hover:border-amber-300 hover:bg-amber-50 transition-all"
            >
              <div className="h-14 w-14 rounded-full bg-amber-50 flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                <FolderPlusIcon className="w-7 h-7 text-amber-600" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900 group-hover:text-amber-600 transition-colors">
                  New Collection
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Create a collection at this path
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MissingSlugPage
