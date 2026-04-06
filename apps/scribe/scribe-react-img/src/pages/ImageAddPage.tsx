import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { useRouteContext } from 'scribe-react-common/src/context/routeContext'
import { Collection } from 'scribe-data'
import type { BulkUploadPlan } from 'scribe-data'
import { TributaryStream } from 'tributary-client'
import ImageDialog from '../components/ImageDialog'
import BulkUploadDialog from '../components/BulkUploadDialog'
import { buildUploadPlan } from '../utils/buildUploadPlan'
import type { FolderFileEntry } from '../utils/readFolderEntries'
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
  const { client } = useTributary()
  const routeCtx = useRouteContext()

  // Bulk upload state
  const [bulkPlan, setBulkPlan] = useState<BulkUploadPlan | null>(null)
  const [bulkFiles, setBulkFiles] = useState<Map<number, File>>(new Map())
  const [bulkStream, setBulkStream] = useState<TributaryStream | null>(null)

  const handleBulkFiles = useCallback(async (files: File[]) => {
    if (!client || !prefix) return

    const entries: FolderFileEntry[] = files.map(file => ({
      file,
      relativePath: file.name,
      folderPath: '',
    }))

    const plan = buildUploadPlan(entries, collectionId ?? null)
    const fileMap = new Map<number, File>()
    files.forEach((file, i) => fileMap.set(i, file))

    const stream = await client.get('scribe', prefix)
    if (!stream) return

    setBulkPlan(plan)
    setBulkFiles(fileMap)
    setBulkStream(stream)
  }, [client, prefix, collectionId])

  const handleBulkComplete = useCallback(() => {
    setBulkPlan(null)
    setBulkFiles(new Map())
    setBulkStream(null)
    navigate(0)
  }, [navigate])

  const handleBulkCancel = useCallback(() => {
    setBulkPlan(null)
    setBulkFiles(new Map())
    setBulkStream(null)
  }, [])

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
    <>
      {bulkPlan && bulkStream && (
        <BulkUploadDialog
          plan={bulkPlan}
          files={bulkFiles}
          stream={bulkStream}
          onComplete={handleBulkComplete}
          onCancel={handleBulkCancel}
        />
      )}
      <ImageDialog
        prefix={prefix}
        collectionId={collectionId}
        ancestors={ancestors}
        onSave={handleSave}
        onCancel={handleCancel}
        onBulkFiles={handleBulkFiles}
      />
    </>
  )
}

export default ImageAddPage
