import React, { useState, useEffect, useCallback } from 'react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useTributary } from '../context/tributaryContext'

export interface EditCollectionModalProps {
  isOpen: boolean
  onClose: () => void
  collectionUuid: string
  currentTitle: string
  prefix: string
  /** When true, the library is still syncing and saves are disabled. */
  syncing?: boolean
  onSaved: (newTitle: string) => void
}

export const EditCollectionModal: React.FC<EditCollectionModalProps> = ({
  isOpen, onClose, collectionUuid, currentTitle, prefix, syncing, onSaved
}) => {
  const [title, setTitle] = useState(currentTitle)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { client } = useTributary()

  useEffect(() => {
    if (isOpen) {
      setTitle(currentTitle)
      setError(null)
      setIsSaving(false)
    }
  }, [isOpen, currentTitle])

  const onSave = useCallback(async () => {
    const trimmed = title.trim()
    if (!trimmed || !client) return

    if (trimmed === currentTitle) {
      onClose()
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      const { renameCollection, indexAll } = await import('scribe-data')

      const stream = await client.get('scribe', prefix)
      if (!stream) throw new Error('Library not found')

      await renameCollection(stream, collectionUuid, trimmed)
      await stream.sync(1000)
      await indexAll(stream.local())

      onSaved(trimmed)
    } catch (err: any) {
      setError(err.message || 'Failed to rename collection')
    } finally {
      setIsSaving(false)
    }
  }, [title, currentTitle, client, prefix, collectionUuid, onSaved, onClose])

  if (!isOpen) return null

  const trimmed = title.trim()
  const canSave = trimmed.length > 0 && !isSaving && !syncing

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Edit Collection</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <label htmlFor="edit-collection-title" className="block text-sm font-medium text-gray-700 mb-1">
            Name
          </label>
          <input
            id="edit-collection-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) {
                onSave()
              }
            }}
          />
        </div>

        {syncing && (
          <div className="mb-4 text-blue-700 bg-blue-50 px-3 py-2 rounded-lg text-sm">
            Library is syncing — editing will be available once sync completes.
          </div>
        )}

        {error && (
          <div className="mb-4 text-red-700 bg-red-50 px-3 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              canSave
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-blue-400 cursor-not-allowed'
            }`}
          >
            {isSaving ? (
              <>
                <svg className="animate-spin -ml-1 mr-1.5 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
