import React from 'react'
import { useNavigate } from 'react-router'
import { PencilIcon, PlusIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import { renderMarkdown } from '../utils/markdown'

interface NoteViewPageProps {
  content: string
  title: string
  slugPath: string
  prefix: string
  splatPath: string
}

const NoteViewPage: React.FC<NoteViewPageProps> = ({ content, slugPath, prefix, splatPath }) => {
  const navigate = useNavigate()

  const handleEdit = () => {
    navigate(`/pk/${prefix}/${slugPath}&edit`)
  }

  const handleNewNote = () => {
    navigate(`/pk/${prefix}/+note`)
  }

  const handleBack = () => {
    navigate(`/pk/${prefix}/`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={handleBack}
                className="text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors inline-flex items-center font-medium"
              >
                <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
                Back
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleEdit}
                className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <PencilIcon className="w-4 h-4 mr-1.5" />
                Edit
              </button>

              <button
                onClick={handleNewNote}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <PlusIcon className="w-4 h-4 mr-1.5" />
                New
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="bg-white rounded-xl shadow overflow-hidden p-6 md:p-8">
          <div
            className="prose prose-lg max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content, prefix, splatPath) }}
          />
        </div>
      </div>
    </div>
  )
}

export default NoteViewPage
