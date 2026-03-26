import React, { useEffect, useState } from 'react'
import { PhotoIcon } from '@heroicons/react/24/outline'

interface ImagePreviewProps {
  file: File | null
  existingUrl?: string
}

const ImagePreview: React.FC<ImagePreviewProps> = ({ file, existingUrl }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(existingUrl || null)

  useEffect(() => {
    if (!file) {
      if (!existingUrl) setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file, existingUrl])

  if (!previewUrl) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-48 bg-gray-50 border-2 border-dashed border-gray-300 rounded-xl">
        <PhotoIcon className="w-12 h-12 text-gray-300" />
        <p className="mt-2 text-sm text-gray-500">No image selected</p>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center w-full bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
      <img
        src={previewUrl}
        alt="Preview"
        className="max-h-64 max-w-full object-contain"
      />
    </div>
  )
}

export default ImagePreview
