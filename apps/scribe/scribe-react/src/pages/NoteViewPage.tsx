import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { PencilIcon, ArrowLeftIcon, ArrowRightIcon } from '@heroicons/react/24/outline'
import { Collection } from 'scribe-data'
import { renderMarkdown } from '../utils/markdown'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { MoveModal } from '../components/MoveModal'
import { useBottomNav } from '../context/bottomNavContext'
import { useTributary } from '../context/tributaryContext'
import VersionFooter from '../components/VersionFooter'

interface NoteViewPageProps {
  content: string
  title: string
  slugPath: string
  prefix: string
  splatPath: string
  ancestors: Collection[]
  libraryName: string
  blockUuid: string
  versionUuid?: string
}

const NoteViewPage: React.FC<NoteViewPageProps> = ({ content, slugPath, prefix, splatPath, ancestors, libraryName, blockUuid, versionUuid }) => {
  const navigate = useNavigate()
  const { setFloatingAction } = useBottomNav()
  const { client } = useTributary()
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [versionPosition, setVersionPosition] = useState<{ position: number; total: number } | null>(null)

  // Fetch version position info when props are available
  useEffect(() => {
    if (!blockUuid || !versionUuid || !client || !prefix) return

    const loadVersionInfo = async () => {
      try {
        const stream = await client.get('scribe', prefix)
        if (!stream) return
        const localDb = stream.local()
        const { getVersionPosition } = await import('scribe-data')
        const pos = await getVersionPosition(localDb, blockUuid, versionUuid)
        if (pos) {
          setVersionPosition({ position: pos.position, total: pos.total })
        }
      } catch {
        // Silently ignore version info errors
      }
    }
    loadVersionInfo()
  }, [blockUuid, versionUuid, client, prefix])

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

  const handleMoved = (newSlugPath: string) => {
    setShowMoveModal(false)
    navigate(`/pk/${prefix}/${newSlugPath}`)
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
                <ArrowLeftIcon className="w-4 h-4" />
              </button>
              <h1 className="text-xl font-bold text-gray-900 truncate max-w-[200px] sm:max-w-md">
                {(() => {
                  const nonRootAncestors = ancestors.filter(a => a.parent_collection_uuid !== null)
                  return nonRootAncestors.length > 0
                    ? nonRootAncestors[nonRootAncestors.length - 1].title
                    : libraryName
                })()}
              </h1>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Breadcrumbs + Move button */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <Breadcrumbs ancestors={ancestors} prefix={prefix} allLinks trailingSlug={slugPath.split('/').pop()} />
          </div>
          <button
            onClick={() => setShowMoveModal(true)}
            className="flex-shrink-0 ml-2 inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors"
          >
            <ArrowRightIcon className="w-4 h-4" />
            <span className="hidden md:inline">Move</span>
          </button>
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden p-6 md:p-8">
          <div
            className="prose prose-lg max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content, prefix, splatPath) }}
          />
        </div>

        {versionUuid && versionPosition && (
          <div className="mt-3 px-2">
            <VersionFooter
              versionUuid={versionUuid}
              position={versionPosition.position}
              total={versionPosition.total}
            />
          </div>
        )}
      </div>

      <MoveModal
        isOpen={showMoveModal}
        onClose={() => setShowMoveModal(false)}
        entityType="note"
        entityId={blockUuid}
        currentSlugPath={slugPath}
        prefix={prefix}
        onMoved={handleMoved}
      />
    </div>
  )
}

export default NoteViewPage
