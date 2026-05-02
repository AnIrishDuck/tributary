import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { ArrowLeftIcon, PhotoIcon } from '@heroicons/react/24/outline'
import { Collection, ImageBlockBody } from 'scribe-data'
import { SlugActionBar } from 'scribe-react-common/src/components/SlugActionBar'
import { useRouteContext } from 'scribe-react-common/src/context/routeContext'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { getErrorMessage } from 'scribe-react-common/src/utils/errors'

export interface ImageViewPageProps {
  body: ImageBlockBody
  title: string
  slugPath: string
  prefix: string
  ancestors: Collection[]
  libraryName: string
  blockUuid: string
  readOnly?: boolean
}

const ImageViewPage: React.FC<ImageViewPageProps> = ({
  body,
  title,
  slugPath,
  prefix,
  ancestors,
  libraryName,
  blockUuid,
  readOnly = false,
}) => {
  const navigate = useNavigate()
  const routeCtx = useRouteContext()
  const { client } = useTributary()
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Compute parent collection path from slugPath (remove last segment which is the image)
  const parentSlugPath = slugPath.split('/').slice(0, -1).join('/')

  // Fetch and decrypt the blob
  useEffect(() => {
    let cancelled = false
    const fetchBlob = async () => {
      if (!client || !prefix) return

      try {
        setLoading(true)
        setError(null)
        const stream = await client.get('scribe', prefix)
        if (!stream) {
          throw new Error('Failed to get library')
        }

        const blob = stream.blob()
        const data = await blob.download(body.blobHash)

        if (cancelled) return

        const mimeType = body.contentType || 'application/octet-stream'
        const blobObj = new Blob([data], { type: mimeType })
        const url = URL.createObjectURL(blobObj)
        setObjectUrl(url)
      } catch (err: unknown) {
        if (!cancelled) {
          setError('Failed to load image: ' + getErrorMessage(err))
          console.error('Error loading image blob:', err)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchBlob()
    return () => {
      cancelled = true
    }
  }, [client, prefix, body.blobHash, body.contentType])

  // Clean up object URL on unmount or when it changes
  useEffect(() => {
    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [objectUrl])

  const handleBack = () => {
    if (parentSlugPath) {
      navigate(routeCtx.buildPath(parentSlugPath))
    } else {
      navigate(routeCtx.buildPath())
    }
  }

  const handleMoved = (newSlugPath: string) => {
    navigate(routeCtx.buildPath(newSlugPath))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
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
        <SlugActionBar
          ancestors={ancestors}
          prefix={prefix}
          slugPath={slugPath}
          entityType="image"
          entityId={blockUuid}
          showHistory
          readOnly={readOnly}
          onMoved={handleMoved}
        />

        <div className="bg-white rounded-xl shadow overflow-hidden p-6 md:p-8">
          {/* Image display */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-6 h-6 border-2 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-3" role="status" aria-label="Loading image"></div>
              <p className="text-sm text-gray-500">Loading image...</p>
            </div>
          )}

          {error && (
            <div className="flex flex-col items-center justify-center py-16">
              <PhotoIcon className="w-12 h-12 text-gray-300 mb-3" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {objectUrl && !loading && (
            <div className="flex flex-col items-center">
              <img
                src={objectUrl}
                alt={body.altText || title || 'Image'}
                className="max-w-full rounded-lg"
                style={{
                  maxHeight: '70vh',
                  objectFit: 'contain',
                }}
              />
            </div>
          )}

          {/* Title */}
          {title && (
            <h2 className="mt-4 text-lg font-semibold text-gray-900 text-center">{title}</h2>
          )}
        </div>

        {/* Metadata footer */}
        <div className="mt-3 px-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-400">
            {body.fileName && (
              <span>{body.fileName}</span>
            )}
            <span>{body.contentType}</span>
            {body.width && body.height && (
              <span>{body.width} × {body.height}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ImageViewPage
