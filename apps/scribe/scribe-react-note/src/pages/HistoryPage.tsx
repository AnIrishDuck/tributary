import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { Collection } from 'scribe-data'
import { Breadcrumbs } from 'scribe-react-common/src/components/Breadcrumbs'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import VersionTree, { buildTree } from '../components/VersionTree'
import type { TreeNode } from '../components/VersionTree'

interface HistoryPageProps {
  prefix: string
  blockUuid: string
  slugPath: string
  ancestors: Collection[]
  libraryName: string
}

const HistoryPage: React.FC<HistoryPageProps> = ({ prefix, blockUuid, slugPath, ancestors, libraryName }) => {
  const navigate = useNavigate()
  const { client } = useTributary()
  const [roots, setRoots] = useState<TreeNode[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      if (!client || !prefix) return
      try {
        const stream = await client.get('scribe', prefix)
        if (!stream) return
        const localDb = stream.local()
        const { getVersionTree } = await import('scribe-data')
        const nodes = await getVersionTree(localDb, blockUuid)
        setRoots(buildTree(nodes))
      } catch {
        setRoots([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [client, prefix, blockUuid])

  const noteUrl = `/pk/${prefix}/${slugPath}`

  const handleBack = () => {
    navigate(noteUrl)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={handleBack}
                className="text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-lg transition-colors inline-flex items-center font-medium"
              >
                <ArrowLeftIcon className="w-4 h-4" />
              </button>
              <h1 className="text-xl font-bold text-gray-900">Version History</h1>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="mb-4">
          <Breadcrumbs ancestors={ancestors} prefix={prefix} allLinks trailingSlug={slugPath.split('/').pop()} />
        </div>

        <div className="bg-white rounded-xl shadow overflow-hidden p-6">
          {loading && <div className="text-gray-500">Loading version history...</div>}
          {!loading && roots && roots.length === 0 && (
            <div className="text-gray-500">No version history available.</div>
          )}
          {!loading && roots && roots.map((root) => (
            <VersionTree
              key={root.version_uuid}
              node={root}
              slugPath={slugPath}
              prefix={prefix}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default HistoryPage
