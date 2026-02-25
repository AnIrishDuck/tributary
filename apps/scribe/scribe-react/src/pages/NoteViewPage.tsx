import React, { useEffect } from 'react'
import { useNavigate, Link } from 'react-router'
import { PencilIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import { Collection } from 'scribe-data'
import { renderMarkdown } from '../utils/markdown'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { useBottomNav } from '../context/bottomNavContext'

interface NoteViewPageProps {
  content: string
  title: string
  slugPath: string
  prefix: string
  splatPath: string
  ancestors: Collection[]
  libraryName: string
}

const NoteViewPage: React.FC<NoteViewPageProps> = ({ content, slugPath, prefix, splatPath, ancestors, libraryName }) => {
  const navigate = useNavigate()
  const { setFloatingAction } = useBottomNav()

  // Compute parent collection path from slugPath (remove last segment which is the note)
  const parentSlugPath = slugPath.split('/').slice(0, -1).join('/')

  const editUrl = `/pk/${prefix}/${slugPath}&edit`

  // Set Edit as the floating action button in the bottom nav
  useEffect(() => {
    setFloatingAction({ icon: PencilIcon, label: 'Edit', to: editUrl })
    return () => setFloatingAction(null)
  }, [editUrl, setFloatingAction])

  const handleBack = () => {
    if (parentSlugPath) {
      navigate(`/pk/${prefix}/${parentSlugPath}`)
    } else {
      navigate(`/pk/${prefix}/`)
    }
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
                <ArrowLeftIcon className="w-4 h-4 md:mr-1.5" />
                <span className="hidden md:inline">Back</span>
              </button>
            </div>
            <Link
              to={editUrl}
              className="hidden md:inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <PencilIcon className="w-4 h-4" />
              Edit
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumbs (show path to parent collection, not the note itself) */}
        {ancestors.length > 0 && (
          <Breadcrumbs ancestors={ancestors} prefix={prefix} allLinks />
        )}

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
