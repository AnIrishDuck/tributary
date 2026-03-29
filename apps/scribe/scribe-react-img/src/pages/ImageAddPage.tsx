import React from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { useRouteContext } from 'scribe-react-common/src/context/routeContext'
import { Collection } from 'scribe-data'
import ImageDialog from '../components/ImageDialog'
import { saveImage } from '../actions/saveImage'

export interface ImageAddPageProps {
  prefix: string
  collectionId?: string
  cancelPath: string
  collectionLabel: string
  ancestors: Collection[]
}

const ImageAddPage: React.FC<ImageAddPageProps> = ({
  prefix,
  collectionId,
  cancelPath,
  collectionLabel,
  ancestors,
}) => {
  const navigate = useNavigate()
  const location = useLocation()
  const { client } = useTributary()
  const routeCtx = useRouteContext()

  // Accept a camera-captured file passed via navigation state
  const cameraFile = (location.state as { cameraFile?: File } | null)?.cameraFile

  const handleSave = async (params: {
    file: File
    slug: string
    title: string
    width: number
    height: number
  }) => {
    if (!client || !prefix) {
      throw new Error('Tributary client not available')
    }

    const stream = await client.get('scribe', prefix)
    if (!stream) {
      throw new Error('Failed to get library')
    }

    const fileData = new Uint8Array(await params.file.arrayBuffer())

    const { slugPath } = await saveImage(stream, {
      fileData,
      contentType: params.file.type,
      fileName: params.file.name,
      slug: params.slug,
      title: params.title || undefined,
      width: params.width,
      height: params.height,
      collectionId: collectionId ?? null,
    })

    // Navigate to the new image's slug path
    if (slugPath.length > 0) {
      navigate(routeCtx.buildPath(slugPath.join('/')))
    } else {
      navigate(routeCtx.buildPath())
    }
  }

  const handleCancel = () => {
    navigate(cancelPath)
  }

  return (
    <ImageDialog
      prefix={prefix}
      collectionId={collectionId}
      ancestors={ancestors}
      initialFile={cameraFile}
      onSave={handleSave}
      onCancel={handleCancel}
    />
  )
}

export default ImageAddPage
