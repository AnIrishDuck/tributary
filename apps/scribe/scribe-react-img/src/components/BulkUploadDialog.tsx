import React, { useState, useCallback, useMemo } from 'react'
import { XMarkIcon, CheckIcon, PencilIcon } from '@heroicons/react/24/outline'
import { TributaryStream } from 'tributary-client'
import { SortMenu, SortOptions } from 'scribe-react-common/src/components/SortMenu'
import {
  ensureBulkCollections,
  createImageBlock,
  indexAll,
  validateBulkUploadPlan,
  titleToSlug,
} from 'scribe-data'
import type { BulkUploadPlan, BulkPlanValidationError } from 'scribe-data'

type ImageStatus = 'pending' | 'uploading' | 'done' | 'error'

interface ImageRowStatus {
  index: number
  status: ImageStatus
  error?: string
}

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
  plan: initialPlan,
  files,
  stream,
  onComplete,
  onCancel,
}) => {
  const [plan, setPlan] = useState<BulkUploadPlan>(initialPlan)
  const [phase, setPhase] = useState<'confirm' | 'uploading' | 'done'>('confirm')
  const [statuses, setStatuses] = useState<ImageRowStatus[]>(
    initialPlan.images.map((_, i) => ({ index: i, status: 'pending' }))
  )
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<SortOptions>({ type: 'modified', order: 'asc' })
  const [editingImage, setEditingImage] = useState<number | null>(null)
  const [editingCollection, setEditingCollection] = useState<number | null>(null)

  // Validate plan on every change
  const validation = useMemo(() => validateBulkUploadPlan(plan), [plan])

  // Build a lookup: errors by type+index+field
  const errorsByKey = useMemo(() => {
    const map = new Map<string, BulkPlanValidationError>()
    for (const err of validation.errors) {
      map.set(`${err.type}:${err.index}:${err.field}`, err)
    }
    return map
  }, [validation])

  const getError = useCallback(
    (type: 'image' | 'collection', index: number, field: 'slug' | 'title') =>
      errorsByKey.get(`${type}:${index}:${field}`),
    [errorsByKey],
  )

  // Compute a sorted order of original indices
  const sortedIndices = useMemo(() => {
    const indices = plan.images.map((_, i) => i)
    indices.sort((a, b) => {
      const imgA = plan.images[a]
      const imgB = plan.images[b]
      if (sort.type === 'alphabetical') {
        const cmp = imgA.fileName.localeCompare(imgB.fileName)
        return sort.order === 'asc' ? cmp : -cmp
      }
      const cmp = (imgA.lastModified ?? 0) - (imgB.lastModified ?? 0)
      return sort.order === 'asc' ? cmp : -cmp
    })
    return indices
  }, [plan.images, sort])

  const updateStatus = useCallback((index: number, status: ImageStatus, errorMsg?: string) => {
    setStatuses(prev => prev.map(s =>
      s.index === index ? { ...s, status, error: errorMsg } : s
    ))
  }, [])

  const updateImageField = useCallback((index: number, field: 'title' | 'slug', value: string) => {
    setPlan(prev => {
      const images = [...prev.images]
      images[index] = { ...images[index], [field]: value }
      return { ...prev, images }
    })
  }, [])

  const updateImageTitle = useCallback((index: number, title: string) => {
    setPlan(prev => {
      const images = [...prev.images]
      images[index] = { ...images[index], title, slug: titleToSlug(title) }
      return { ...prev, images }
    })
  }, [])

  const updateCollectionField = useCallback((index: number, field: 'title' | 'slug', value: string) => {
    setPlan(prev => {
      const collections = [...prev.collections]
      collections[index] = { ...collections[index], [field]: value }
      return { ...prev, collections }
    })
  }, [])

  const updateCollectionTitle = useCallback((index: number, title: string) => {
    setPlan(prev => {
      const collections = [...prev.collections]
      collections[index] = { ...collections[index], title, slug: titleToSlug(title) }
      return { ...prev, collections }
    })
  }, [])

  const handleUpload = useCallback(async () => {
    setPhase('uploading')
    setError(null)

    try {
      // 1. Create sub-collections
      const collectionMap = await ensureBulkCollections(stream, plan, 'web-ui')

      // 2. Upload each image serially in sorted order
      for (const i of sortedIndices) {
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
  }, [stream, plan, files, sortedIndices, updateStatus])

  // Group images by collection folder, using sorted order
  const groupedImages = useMemo(() => {
    const groups = new Map<string, { index: number; slug: string; title?: string; fileName: string }[]>()
    for (const i of sortedIndices) {
      const img = plan.images[i]
      const key = img.folderPath || '(root)'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push({ index: i, slug: img.slug, title: img.title, fileName: img.fileName })
    }
    return groups
  }, [plan.images, sortedIndices])

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

  // Find collection index by folderPath for editing
  const collectionIndexByPath = useMemo(() => {
    const map = new Map<string, number>()
    plan.collections.forEach((col, i) => map.set(col.folderPath, i))
    return map
  }, [plan.collections])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-white rounded-2xl shadow-xl max-w-2xl w-full mx-4 flex flex-col"
        style={{ maxHeight: '80vh' }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-white rounded-t-2xl flex-shrink-0 overflow-visible relative z-20"
        >
          <h2 className="text-lg font-bold text-gray-900">
            {phase === 'confirm' ? 'Bulk Upload' : phase === 'uploading' ? 'Uploading...' : 'Upload Complete'}
          </h2>
          <div className="flex items-center gap-1">
            {phase === 'confirm' && (
              <SortMenu sort={sort} onSortChange={setSort} />
            )}
            {phase === 'confirm' && (
              <button
                onClick={onCancel}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Summary */}
        <div
          className="px-6 py-3 bg-gray-50 border-b border-gray-200 text-sm text-gray-600 flex-shrink-0"
        >
          {totalImages} image{totalImages !== 1 ? 's' : ''} in {totalCollections + 1} collection{totalCollections !== 0 ? 's' : ''}
        </div>

        {error && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        {!validation.valid && phase === 'confirm' && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-700">
            {validation.errors.length} validation {validation.errors.length === 1 ? 'error' : 'errors'} — fix before uploading
          </div>
        )}

        {/* Image list */}
        <div className="px-6 py-4 flex-1" style={{ overflowY: 'auto', minHeight: 0 }}>
          {[...groupedImages.entries()].map(([folder, images]) => {
            const colIdx = collectionIndexByPath.get(folder)
            const isEditingCol = editingCollection !== null && colIdx === editingCollection
            const col = colIdx !== undefined ? plan.collections[colIdx] : null

            return (
              <div key={folder} className="mb-4">
                {/* Collection header — editable in confirm phase */}
                {col && phase === 'confirm' ? (
                  isEditingCol ? (
                    <div className="mb-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 w-10">Title</label>
                        <input
                          type="text"
                          value={col.title}
                          onChange={(e) => updateCollectionTitle(colIdx!, e.target.value)}
                          className={`text-sm border rounded px-2 py-1 flex-1 ${getError('collection', colIdx!, 'title') ? 'border-red-400' : 'border-gray-300'}`}
                          data-testid={`collection-title-${colIdx}`}
                        />
                      </div>
                      {getError('collection', colIdx!, 'title') && (
                        <p className="text-xs text-red-600 ml-12">{getError('collection', colIdx!, 'title')!.message}</p>
                      )}
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-500 w-10">Slug</label>
                        <input
                          type="text"
                          value={col.slug}
                          onChange={(e) => updateCollectionField(colIdx!, 'slug', e.target.value)}
                          className={`text-sm border rounded px-2 py-1 flex-1 font-mono ${getError('collection', colIdx!, 'slug') ? 'border-red-400' : 'border-gray-300'}`}
                          data-testid={`collection-slug-${colIdx}`}
                        />
                      </div>
                      {getError('collection', colIdx!, 'slug') && (
                        <p className="text-xs text-red-600 ml-12">{getError('collection', colIdx!, 'slug')!.message}</p>
                      )}
                      <button
                        onClick={() => setEditingCollection(null)}
                        className="text-xs text-blue-600 hover:text-blue-800 ml-12"
                      >
                        Done editing
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mb-2 group">
                      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {col.title}
                      </h3>
                      <button
                        onClick={() => setEditingCollection(colIdx!)}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
                        aria-label={`Edit collection ${col.title}`}
                      >
                        <PencilIcon className="w-3.5 h-3.5" />
                      </button>
                      {(getError('collection', colIdx!, 'slug') || getError('collection', colIdx!, 'title')) && (
                        <span className="text-xs text-red-600">has errors</span>
                      )}
                    </div>
                  )
                ) : (
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    {folder === '(root)' ? 'Current collection' : folder}
                  </h3>
                )}

                <div className="space-y-1">
                  {images.map(({ index, slug, title, fileName }) => {
                    const isEditing = editingImage === index && phase === 'confirm'
                    const slugErr = getError('image', index, 'slug')
                    const titleErr = getError('image', index, 'title')

                    if (isEditing) {
                      return (
                        <div key={index} className="py-1.5 px-2 rounded-lg bg-gray-50 space-y-1">
                          <div className="text-xs text-gray-500 mb-1">{fileName}</div>
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-500 w-10">Title</label>
                            <input
                              type="text"
                              value={plan.images[index].title ?? ''}
                              onChange={(e) => updateImageTitle(index, e.target.value)}
                              className={`text-sm border rounded px-2 py-1 flex-1 ${titleErr ? 'border-red-400' : 'border-gray-300'}`}
                              data-testid={`image-title-${index}`}
                            />
                          </div>
                          {titleErr && <p className="text-xs text-red-600 ml-12">{titleErr.message}</p>}
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-500 w-10">Slug</label>
                            <input
                              type="text"
                              value={plan.images[index].slug}
                              onChange={(e) => updateImageField(index, 'slug', e.target.value)}
                              className={`text-sm border rounded px-2 py-1 flex-1 font-mono ${slugErr ? 'border-red-400' : 'border-gray-300'}`}
                              data-testid={`image-slug-${index}`}
                            />
                          </div>
                          {slugErr && <p className="text-xs text-red-600 ml-12">{slugErr.message}</p>}
                          <button
                            onClick={() => setEditingImage(null)}
                            className="text-xs text-blue-600 hover:text-blue-800 ml-12"
                          >
                            Done editing
                          </button>
                        </div>
                      )
                    }

                    return (
                      <div key={index} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-gray-50 group">
                        <StatusIcon status={statuses[index].status} />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-gray-900 truncate block">{fileName}</span>
                          <span className={`text-xs ${slugErr || titleErr ? 'text-red-600' : 'text-gray-500'}`}>
                            {slug}{title ? ` — ${title}` : ''}
                          </span>
                          {slugErr && <span className="text-xs text-red-600 ml-2">{slugErr.message}</span>}
                          {titleErr && <span className="text-xs text-red-600 ml-2">{titleErr.message}</span>}
                        </div>
                        {phase === 'confirm' && (
                          <button
                            onClick={() => setEditingImage(index)}
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 transition-opacity"
                            aria-label={`Edit ${fileName}`}
                          >
                            <PencilIcon className="w-4 h-4" />
                          </button>
                        )}
                        {statuses[index].error && (
                          <span className="text-xs text-red-600">{statuses[index].error}</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 bg-white rounded-b-2xl flex-shrink-0"
        >
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
                disabled={!validation.valid}
                className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                  validation.valid
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : 'bg-blue-300 cursor-not-allowed'
                }`}
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
  )
}

export default BulkUploadDialog
