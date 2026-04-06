import React, { useState, useRef, useCallback } from 'react'
import { ArrowUpOnSquareIcon, XMarkIcon, PhotoIcon } from '@heroicons/react/24/outline'
import { titleToSlug } from 'scribe-data'
import { Collection } from 'scribe-data'
import { Breadcrumbs } from 'scribe-react-common/src/components/Breadcrumbs'
import ImagePreview from './ImagePreview'

export interface ImageDialogProps {
  prefix: string
  collectionId?: string
  ancestors: Collection[]
  onSave: (params: {
    file: File
    slug: string
    title: string
    width: number
    height: number
  }) => Promise<void>
  onCancel: () => void
  /** Called when multiple files are selected (e.g. on mobile). */
  onBulkFiles?: (files: File[]) => void
}

/** Derive a slug from a filename by stripping the extension and slugifying. */
function fileNameToSlug(name: string): string {
  const withoutExt = name.replace(/\.[^.]+$/, '')
  return titleToSlug(withoutExt)
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

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/

const ImageDialog: React.FC<ImageDialogProps> = ({
  prefix,
  collectionId,
  ancestors,
  onSave,
  onCancel,
  onBulkFiles,
}) => {
  const [file, setFile] = useState<File | null>(null)
  const [slug, setSlug] = useState('')
  const [title, setTitle] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [titleTouched, setTitleTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const handleFileSelect = useCallback((selected: File) => {
    if (!selected.type.startsWith('image/')) {
      setError('Please select an image file')
      return
    }
    setFile(selected)
    setError(null)
    const derived = fileNameToSlug(selected.name)
    if (!slugTouched) {
      setSlug(derived)
    }
    if (!titleTouched) {
      setTitle(slugTouched ? slug : derived)
    }
  }, [slugTouched, titleTouched, slug])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) handleFileSelect(droppedFile)
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleSlugChange = (value: string) => {
    setSlugTouched(true)
    // Normalize: lowercase, spaces to hyphens, only allow valid slug characters
    setSlug(
      value
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
    )
  }

  const validateSlug = (): string | null => {
    if (!slug) return 'Slug is required'
    if (!SLUG_PATTERN.test(slug)) return 'Slug must be lowercase letters, numbers, and hyphens (no leading/trailing hyphens)'
    return null
  }

  const handleSave = async () => {
    if (!file) {
      setError('Please select an image')
      return
    }

    const slugError = validateSlug()
    if (slugError) {
      setError(slugError)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const { width, height } = await getImageDimensions(file)
      await onSave({ file, slug, title, width, height })
    } catch (err: any) {
      setError('Failed to save image: ' + (err.message || 'Unknown error'))
      console.error('Error saving image:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-bold text-gray-900">Add Image</h1>
            <button
              onClick={onCancel}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
            >
              <XMarkIcon className="w-4 h-4 mr-1.5" />
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 md:py-8 w-full flex flex-col">
        {ancestors && (
          <div className="mb-4">
            <Breadcrumbs ancestors={ancestors} prefix={prefix} allLinks />
          </div>
        )}

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-4">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow overflow-hidden p-6 md:p-8 space-y-6">
          {/* File picker / drop zone */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Image file <span className="text-red-500">*</span>
            </label>
            <div
              ref={dropZoneRef}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer"
            >
              {file ? (
                <ImagePreview file={file} />
              ) : (
                <div className="flex flex-col items-center justify-center w-full h-48 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-colors">
                  <PhotoIcon className="w-12 h-12 text-gray-300" />
                  <p className="mt-2 text-sm text-gray-500">
                    Click to select or drag and drop an image
                  </p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                const fileList = e.target.files
                if (!fileList || fileList.length === 0) return
                if (fileList.length > 1 && onBulkFiles) {
                  const images = Array.from(fileList).filter(f => f.type.startsWith('image/'))
                  if (images.length > 1) {
                    onBulkFiles(images)
                    return
                  }
                }
                const selected = fileList[0]
                if (selected) handleFileSelect(selected)
              }}
            />
            {file && (
              <p className="mt-1 text-xs text-gray-500">
                {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          {/* Slug */}
          <div>
            <label htmlFor="image-slug" className="block text-sm font-medium text-gray-700 mb-1">
              Slug <span className="text-red-500">*</span>
            </label>
            <input
              id="image-slug"
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="my-image"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Lowercase letters, numbers, and hyphens only
            </p>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="image-title" className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-gray-400">(optional)</span>
            </label>
            <input
              id="image-title"
              type="text"
              value={title}
              onChange={(e) => { setTitleTouched(true); setTitle(e.target.value) }}
              placeholder="A descriptive title"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Save FAB */}
      <button
        onClick={handleSave}
        disabled={isLoading}
        className="fixed z-50 right-4 md:right-8 fab-bottom md:bottom-8 flex items-center justify-center w-14 h-14 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200 text-white"
        aria-label="Save Image"
      >
        {isLoading ? (
          <svg className="animate-spin h-6 w-6 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        ) : (
          <ArrowUpOnSquareIcon className="w-6 h-6" />
        )}
      </button>
    </div>
  )
}

export default ImageDialog
