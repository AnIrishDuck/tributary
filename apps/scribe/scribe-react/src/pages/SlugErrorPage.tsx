import React from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

interface SlugErrorPageProps {
  message: string
  prefix?: string
}

const SlugErrorPage: React.FC<SlugErrorPageProps> = ({ message, prefix }) => {
  const navigate = useNavigate()

  const handleBack = () => {
    if (prefix) {
      navigate(`/pk/${prefix}/`)
    } else {
      navigate('/')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4">
      <div className="max-w-3xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow p-4 mb-4">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-red-500 mt-0.5 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-red-900">Error loading note</h3>
              <p className="text-red-700 mt-1 text-sm">{message}</p>
            </div>
          </div>
        </div>
        <button
          onClick={handleBack}
          className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
          Back
        </button>
      </div>
    </div>
  )
}

export default SlugErrorPage
