import React, { useState, useCallback, useEffect, useMemo } from 'react'
import { XMarkIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import { TributaryStream } from 'tributary-client'
import {
  ensureBulkCollections,
  createImageBlock,
  indexAll,
} from 'scribe-data'
import type { BulkUploadPlan } from 'scribe-data'

type ImageStatus = 'pending' | 'uploading' | 'done' | 'error'

interface ImageRowStatus {
  index: number
  status: ImageStatus
  error?: string
}

export const PAGE_SIZE = 10

export interface BulkUploadDialogProps {
  plan: BulkUploadPlan
  files: Map<number, File>
  stream: TributaryStream
  onComplete: () => void
  onCancel: () => void
}

/** Read image dimensions by loading into an offscreen <img>. */
function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image for dimension extraction'))
    }
    img.src = url
  })
}

const BulkUploadDialog: React.FC<BulkUploadDialogProps> = ({
  plan,
  files,
  stream,
  onComplete,
  onCancel,
}) => {
  const [phase, setPhase] = useState<'confirm' | 'uploading' | 'done'>('confirm')
  const [statuses, setStatuses] = useState<ImageRowStatus[]>(
    plan.images.map((_, i) => ({ index: i, status: 'pending' }))
  )
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(0)

  const totalPages = Math.max(1, Math.ceil(plan.images.length / PAGE_SIZE))

  const updateStatus = useCallback((index: number, status: ImageStatus, errorMsg?: string) => {
    setStatuses(prev => prev.map(s =>
      s.index === index ? { ...s, status, error: errorMsg } : s
    ))
  }, [])

  // Auto-advance to next page during upload when current page is fully done
  useEffect(() => {
    if (phase !== 'uploading') return
    const pageStart = currentPage * PAGE_SIZE
    const pageEnd = Math.min(pageStart + PAGE_SIZE, plan.images.length)
    const pageStatuses = statuses.slice(pageStart, pageEnd)
    const allPageDone = pageStatuses.every(s => s.status === 'done' || s.status === 'error')
    if (allPageDone && currentPage < totalPages - 1) {
      setCurrentPage(prev => prev + 1)
    }
  }, [statuses, phase, currentPage, totalPages, plan.images.length])

  const handleUpload = useCallback(async () => {
    setPhase('uploading')
    setError(null)

    try {
      // 1. Create sub-collections
      const collectionMap = await ensureBulkCollections(stream, plan, 'web-ui')

      // 2. Upload each image serially
      for (let i = 0; i < plan.images.length; i++) {
        const entry = plan.images[i]
        const file = files.get(i)
        if (!file) {
          updateStatus(i, 'error', 'File not found')
          continue
        }

        updateStatus(i, 'uploading')

        try {
          const fileData = new Uint8Array(await file.arrayBuffer())
          const { width, height } = await getImageDimensions(file)
          const blobHash = await stream.blob().upload(fileData)

          const collectionId = entry.folderPath === ''
            ? plan.rootCollectionId ?? undefined
            : collectionMap.get(entry.folderPath)

          await createImageBlock(stream, {
            blobHash,
            contentType: entry.contentType,
            fileName: entry.fileName,
            slug: entry.slug,
            title: entry.title,
            width,
            height,
            collectionId: collectionId ?? null,
            inserter: 'web-ui',
          })

          updateStatus(i, 'done')
        } catch (err: any) {
          updateStatus(i, 'error', err.message || 'Upload failed')
        }
      }

      // 3. Sync and index
      await stream.sync(1000)
      await indexAll(stream.local())

      setPhase('done')
    } catch (err: any) {
      setError(err.message || 'Bulk upload failed')
      setPhase('done')
    }
  }, [stream, plan, files, updateStatus])

  // Get current page slice and group by collection folder
  const pageStart = currentPage * PAGE_SIZE
  const pageEnd = Math.min(pageStart + PAGE_SIZE, plan.images.length)
  const pageImages = plan.images.slice(pageStart, pageEnd)

  const groupedImages = useMemo(() => {
    return pageImages.reduce<Map<string, { index: number; slug: string; title?: string; fileName: string }[]>>(
      (acc, img, i) => {
        const key = img.folderPath || '(root)'
        if (!acc.has(key)) acc.set(key, [])
        acc.get(key)!.push({ index: pageStart + i, slug: img.slug, title: img.title, fileName: img.fileName })
        return acc
      },
      new Map()
    )
  }, [pageStart, pageEnd, plan.images])

  const totalImages = plan.images.length
  const totalCollections = plan.collections.length

  const StatusIcon: React.FC<{ status: ImageStatus }> = ({ status }) => {
    switch (status) {
      case 'pending':
        return <span className="w-5 h-5 rounded-full border-2 border-gray-300 inline-block" />
      case 'uploading':
        return (
          <svg className="animate-spin h-5 w-5 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        )
      case 'done':
        return <CheckIcon className="w-5 h-5 text-green-600" />
      case 'error':
        return <XMarkIcon className="w-5 h-5 text-red-600" />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full mx-4 flex flex-col" style={{ maxHeight: '80vh' }}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">
            {phase === 'confirm' ? 'Bulk Upload' : phase === 'uploading' ? 'Uploading...' : 'Upload Complete'}
          </h2>
          {phase === 'confirm' && (
            <button
              onClick={onCancel}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XMarkIcon className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Summary */}
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
          {totalImages} image{totalImages !== 1 ? 's' : ''} in {totalCollections + 1} collection{totalCollections !== 0 ? 's' : ''}
        </div>

        {error && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Image list */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {[...groupedImages.entries()].map(([folder, images]) => (
            <div key={folder} className="mb-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                {folder === '(root)' ? 'Current collection' : folder}
              </h3>
              <div className="space-y-1">
                {images.map(({ index, slug, title, fileName }) => (
                  <div key={index} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-50">
                    <StatusIcon status={statuses[index].status} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-900 truncate block">{fileName}</span>
                      <span className="text-xs text-gray-500">{slug}{title ? ` — ${title}` : ''}</span>
                    </div>
                    {statuses[index].error && (
                      <span className="text-xs text-red-600">{statuses[index].error}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between gap-3">
          {/* Pagination controls */}
          {totalPages > 1 ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(p => p - 1)}
                disabled={currentPage === 0}
                className="p-1 rounded text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Previous page"
              >
                <ChevronLeftIcon className="w-5 h-5" />
              </button>
              <span className="text-sm text-gray-600">
                Page {currentPage + 1} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage >= totalPages - 1}
                className="p-1 rounded text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                aria-label="Next page"
              >
                <ChevronRightIcon className="w-5 h-5" />
              </button>
            </div>
          ) : <div />}

          <div className="flex gap-3">
            {phase === 'confirm' && (
              <>
                <button
                  onClick={onCancel}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Upload
                </button>
              </>
            )}
            {phase === 'uploading' && (
              <button
                disabled
                className="px-4 py-2 text-sm font-medium text-white bg-blue-400 rounded-lg cursor-not-allowed"
              >
                Uploading...
              </button>
            )}
            {phase === 'done' && (
              <button
                onClick={onComplete}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default BulkUploadDialog
