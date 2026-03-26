import React, { useState } from 'react'
import { XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

export interface AddPluginModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (url: string, configJson: string) => void
  existingUrls: string[]
}

export const AddPluginModal: React.FC<AddPluginModalProps> = ({
  isOpen, onClose, onConfirm, existingUrls
}) => {
  const [url, setUrl] = useState('')
  const [configJson, setConfigJson] = useState('{}')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetAndClose = () => {
    setUrl('')
    setConfigJson('{}')
    setConfirmed(false)
    setError(null)
    onClose()
  }

  const handleAdd = () => {
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setError('Plugin URL is required')
      return
    }

    if (existingUrls.includes(trimmedUrl)) {
      setError('This plugin is already added')
      return
    }

    // Validate config JSON
    try {
      JSON.parse(configJson)
    } catch {
      setError('Invalid JSON in config')
      return
    }

    if (!confirmed) {
      setError('You must acknowledge the trust warning')
      return
    }

    onConfirm(trimmedUrl, configJson)
    resetAndClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={resetAndClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Add Plugin</h2>
          <button onClick={resetAndClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Trust Warning */}
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <ExclamationTriangleIcon className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800">
              <p className="font-semibold mb-2">
                Plugins are remote code with full access to your decrypted note content.
              </p>
              <p className="mb-1">When you add a plugin to a library, that plugin can:</p>
              <ul className="list-disc list-inside space-y-0.5 ml-1">
                <li>Read and modify every note in that library</li>
                <li>Execute arbitrary JavaScript in your browser</li>
                <li>Make network requests to external servers</li>
                <li>Access anything visible in the browser tab</li>
              </ul>
              <p className="mt-2 font-medium">You must trust the plugin author. Only add plugins from sources you trust.</p>
            </div>
          </div>
        </div>

        {/* URL Input */}
        <div className="mb-4">
          <label htmlFor="plugin-url" className="block text-sm font-medium text-gray-700 mb-1">
            Plugin URL
          </label>
          <input
            id="plugin-url"
            type="text"
            value={url}
            onChange={(e) => { setUrl(e.target.value); setError(null) }}
            placeholder="https://example.com/plugin.js"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            autoFocus
          />
        </div>

        {/* Config Input */}
        <div className="mb-4">
          <label htmlFor="plugin-config" className="block text-sm font-medium text-gray-700 mb-1">
            Configuration (JSON)
          </label>
          <textarea
            id="plugin-config"
            value={configJson}
            onChange={(e) => { setConfigJson(e.target.value); setError(null) }}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm font-mono"
          />
        </div>

        {/* Trust Confirmation */}
        <label className="flex items-start gap-2 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => { setConfirmed(e.target.checked); setError(null) }}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">
            I trust this plugin and understand it will have full access to my decrypted notes
          </span>
        </label>

        {error && (
          <div className="mb-4 flex items-center gap-2 text-red-700 bg-red-50 px-3 py-2 rounded-lg text-sm">
            <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={resetAndClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              url.trim() && confirmed
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-blue-400 cursor-not-allowed'
            }`}
          >
            Add Plugin
          </button>
        </div>
      </div>
    </div>
  )
}
