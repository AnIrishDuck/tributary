import React, { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { getHomeCollections, getLibraries, estimateQuota } from 'scribe-data'
import type { QuotaEstimate } from 'scribe-data'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

const AccountPage: React.FC = () => {
  const { client, session } = useTributary()
  const [libraryCount, setLibraryCount] = useState<number | null>(null)
  const [quota, setQuota] = useState<QuotaEstimate | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!client) return
    let mounted = true

    async function load() {
      const [collections, quotaEstimate] = await Promise.all([
        getHomeCollections(client!).then(c =>
          c !== null ? c : getLibraries(client!)
        ),
        estimateQuota(),
      ])

      if (!mounted) return
      setLibraryCount(collections.length)
      setQuota(quotaEstimate)
      setLoading(false)
    }

    load()
    return () => { mounted = false }
  }, [client])

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back to libraries
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-6">Account</h1>

      <div className="space-y-4">
        {/* Account details */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Account details</h2>
          <dl className="space-y-3">
            <div>
              <dt className="text-sm text-gray-500">Email</dt>
              <dd className="text-sm font-medium text-gray-900">{session?.email ?? 'Not signed in'}</dd>
            </div>
          </dl>
        </div>

        {/* Library stats */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Libraries</h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : (
            <p className="text-sm text-gray-900">
              <span className="font-medium">{libraryCount}</span> {libraryCount === 1 ? 'library' : 'libraries'}
            </p>
          )}
        </div>

        {/* Storage */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Storage</h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : quota ? (
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-900 font-medium">{formatBytes(quota.usage)}</span>
                <span className="text-gray-500">of {formatBytes(quota.quota)}</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (quota.usage / quota.quota) * 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500">Storage estimate unavailable</p>
          )}
        </div>
      </div>
    </div>
  )
}

export default AccountPage
