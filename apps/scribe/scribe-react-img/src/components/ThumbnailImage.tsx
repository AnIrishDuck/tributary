import React from 'react'
import { TributaryStream } from 'tributary-client'
import { useBlob } from 'scribe-react-common/src/hooks/useBlob'

export interface ThumbnailImageProps {
  blobHash: string | null
  stream: TributaryStream | null
  alt: string
  className?: string
  width?: number
  height?: number
  /** Fallback when no blobHash or while loading */
  fallback?: React.ReactNode
}

const ThumbnailImage: React.FC<ThumbnailImageProps> = ({
  blobHash,
  stream,
  alt,
  className,
  width,
  height,
  fallback,
}) => {
  const { objectUrl, loading, error } = useBlob(blobHash, stream)

  if (!blobHash || loading || error || !objectUrl) {
    if (fallback) return <>{fallback}</>
    // Default placeholder with aspect ratio if dimensions provided
    const style: React.CSSProperties = {}
    if (width && height) {
      style.aspectRatio = `${width} / ${height}`
    }
    return (
      <div
        className={className}
        style={{ backgroundColor: '#f3f4f6', ...style }}
        aria-label={alt}
      />
    )
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      className={className}
      width={width}
      height={height}
    />
  )
}

export default ThumbnailImage
