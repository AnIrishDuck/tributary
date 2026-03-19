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
  const { client, server, clearAccount, session } = useTributary()
  const [libraryCount, setLibraryCount] = useState<number | null>(null)
  const [quota, setQuota] = useState<QuotaEstimate | null>(null)
  const [loading, setLoading] = useState(true)
  const [encryptedStorage, setEncryptedStorage] = useState<boolean | null>(null)
  const [toggling, setToggling] = useState(false)

  useEffect(() => {
    if (!client || !server) return
    let mounted = true

    async function load() {
      const [collections, quotaEstimate, config] = await Promise.all([
        getHomeCollections(client!).then(c =>
          c !== null ? c : getLibraries(client!)
        ),
        estimateQuota(),
        server!.getAccountConfig(),
      ])

      if (!mounted) return
      setLibraryCount(collections.length)
      setQuota(quotaEstimate)
      const entry = config.find(e => e.key === 'encryptedStorage')
      setEncryptedStorage(entry?.value === 'true')
      setLoading(false)
    }

    load()
    return () => { mounted = false }
  }, [client, server])

  async function handleToggleEncryptedStorage() {
    if (!server || encryptedStorage === null) return
    const enabling = !encryptedStorage

    if (!enabling) {
      const confirmed = window.confirm(
        'Disabling encrypted storage will clear your local data and require re-syncing. Continue?'
      )
      if (!confirmed) return
    }

    setToggling(true)
    try {
      if (enabling) {
        await server.setAccountConfig('encryptedStorage', 'true')
      } else {
        await server.deleteAccountConfig('encryptedStorage')
      }

      // Wipe this account's local data (incompatible format) and force a fresh start
      if (clearAccount) {
        await clearAccount()
      } else {
        window.location.reload()
      }
    } catch (err) {
      console.error('Failed to toggle encrypted storage:', err)
      setToggling(false)
    }
  }

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

        {/* Security */}
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Security</h2>
          {loading || encryptedStorage === null ? (
            <p className="text-sm text-gray-500">Loading...</p>
          ) : (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-900">Encrypted storage</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {encryptedStorage
                    ? 'Local data is encrypted. Password required on each visit.'
                    : 'Encrypt local data at rest. Requires password on each visit.'}
                </p>
              </div>
              <button
                onClick={handleToggleEncryptedStorage}
                disabled={toggling}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  encryptedStorage ? 'bg-blue-600' : 'bg-gray-200'
                } ${toggling ? 'opacity-50 cursor-not-allowed' : ''}`}
                role="switch"
                aria-checked={encryptedStorage}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    encryptedStorage ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default AccountPage
