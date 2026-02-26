import React, { useState, useEffect, useCallback } from 'react'
import { XMarkIcon, ExclamationTriangleIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { useTributary } from '../context/tributaryContext'

export interface MoveModalProps {
  isOpen: boolean
  onClose: () => void
  entityType: 'note' | 'collection'
  entityId: string
  currentSlugPath: string
  prefix: string
  onMoved: (newSlugPath: string) => void
}

type ValidationState =
  | { status: 'empty' }
  | { status: 'validating' }
  | { status: 'valid'; targetUuid: string | null; resolvedPath: string }
  | { status: 'invalid'; message: string }

export const MoveModal: React.FC<MoveModalProps> = ({
  isOpen, onClose, entityType, entityId, currentSlugPath, prefix, onMoved
}) => {
  const [targetPath, setTargetPath] = useState('')
  const [validation, setValidation] = useState<ValidationState>({ status: 'empty' })
  const [isMoving, setIsMoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { client } = useTributary()

  // Current parent path for relative resolution
  const currentParentPath = currentSlugPath.split('/').slice(0, -1).join('/')

  // Validate the target path whenever input changes
  useEffect(() => {
    if (!targetPath.trim()) {
      setValidation({ status: 'empty' })
      return
    }

    let cancelled = false

    const validate = async () => {
      setValidation({ status: 'validating' })
      try {
        const { resolveLink, resolveSlugPath, getLibrary } = await import('scribe-data')

        // Resolve relative/absolute link
        const resolved = resolveLink(currentParentPath, targetPath.trim())
        if (resolved.type === 'InvalidLink') {
          if (!cancelled) setValidation({ status: 'invalid', message: 'Invalid path: navigates above library root' })
          return
        }

        const absolutePath = resolved.path
        const segments = absolutePath.split('/').filter(s => s.length > 0)

        if (!client) {
          if (!cancelled) setValidation({ status: 'invalid', message: 'Client not available' })
          return
        }
        const stream = await client.get('scribe', prefix)
        if (!stream) {
          if (!cancelled) setValidation({ status: 'invalid', message: 'Library not found' })
          return
        }
        const localDb = stream.local()
        const library = await getLibrary(localDb)
        if (!library) {
          if (!cancelled) setValidation({ status: 'invalid', message: 'Library not found' })
          return
        }

        // Handle root path "/"
        if (segments.length === 0) {
          if (!cancelled) {
            if (entityType === 'note') {
              setValidation({ status: 'valid', targetUuid: null, resolvedPath: '/' })
            } else {
              setValidation({ status: 'valid', targetUuid: library.collection_uuid, resolvedPath: '/' })
            }
          }
          return
        }

        // Resolve the target path
        const result = await resolveSlugPath(localDb, segments, library.collection_uuid)
        if (cancelled) return

        if (!result) {
          setValidation({ status: 'invalid', message: `Path "${absolutePath}" does not exist` })
          return
        }
        if (result.type !== 'collection') {
          setValidation({ status: 'invalid', message: `Path "${absolutePath}" is a note, not a collection` })
          return
        }

        setValidation({ status: 'valid', targetUuid: result.entity.collection_uuid, resolvedPath: absolutePath })
      } catch (err: any) {
        if (!cancelled) setValidation({ status: 'invalid', message: err.message || 'Validation error' })
      }
    }

    validate()
    return () => { cancelled = true }
  }, [targetPath, client, prefix, currentParentPath, entityType])

  const onMove = useCallback(async () => {
    if (validation.status !== 'valid' || !client) return

    setIsMoving(true)
    setError(null)

    try {
      const { moveNote, moveCollection, indexAll } = await import('scribe-data')

      const stream = await client.get('scribe', prefix)
      if (!stream) throw new Error('Library not found')

      const localDb = stream.local()

      if (entityType === 'note') {
        await moveNote(stream, entityId, validation.targetUuid, 'web-ui')
      } else {
        if (!validation.targetUuid) throw new Error('Invalid target for collection move')
        await moveCollection(stream, entityId, validation.targetUuid)
      }

      // Sync and re-index
      await stream.sync(1000)
      await indexAll(localDb)

      // Compute new slug path
      const entitySlug = currentSlugPath.split('/').pop() || ''
      const newPath = validation.resolvedPath === '/'
        ? entitySlug
        : `${validation.resolvedPath.slice(1)}/${entitySlug}`

      onMoved(newPath)
    } catch (err: any) {
      setError(err.message || 'Failed to move')
    } finally {
      setIsMoving(false)
    }
  }, [validation, client, prefix, entityType, entityId, currentSlugPath, onMoved])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">
            Move {entityType === 'note' ? 'Note' : 'Collection'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-500 mb-1">Current path</label>
          <div className="text-sm text-gray-900 font-mono bg-gray-50 px-3 py-2 rounded-lg">
            /{currentSlugPath}
          </div>
        </div>

        <div className="mb-4">
          <label htmlFor="move-target" className="block text-sm font-medium text-gray-700 mb-1">
            Target collection path
          </label>
          <input
            id="move-target"
            type="text"
            value={targetPath}
            onChange={(e) => setTargetPath(e.target.value)}
            placeholder="e.g. /recipes or ../other-collection"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && validation.status === 'valid' && !isMoving) {
                onMove()
              }
            }}
          />
          <p className="mt-1 text-xs text-gray-400">
            Use absolute paths (/path) or relative paths (../sibling)
          </p>
        </div>

        {/* Validation feedback */}
        {validation.status === 'valid' && (
          <div className="mb-4 flex items-center gap-2 text-green-700 bg-green-50 px-3 py-2 rounded-lg text-sm">
            <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
            <span>Will move to <span className="font-mono">{validation.resolvedPath}</span></span>
          </div>
        )}
        {validation.status === 'invalid' && (
          <div className="mb-4 flex items-center gap-2 text-amber-700 bg-amber-50 px-3 py-2 rounded-lg text-sm">
            <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
            <span>{validation.message}</span>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-center gap-2 text-red-700 bg-red-50 px-3 py-2 rounded-lg text-sm">
            <ExclamationTriangleIcon className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
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
            onClick={onMove}
            disabled={validation.status !== 'valid' || isMoving}
            className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              validation.status === 'valid' && !isMoving
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-blue-400 cursor-not-allowed'
            }`}
          >
            {isMoving ? (
              <>
                <svg className="animate-spin -ml-1 mr-1.5 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Moving...
              </>
            ) : (
              'Move'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
