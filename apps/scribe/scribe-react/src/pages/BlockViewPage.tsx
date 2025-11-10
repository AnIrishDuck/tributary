import React, { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import * as base64url from 'urlsafe-base64'
import { micromark } from 'micromark'

interface BlockSlugInfo {
  block_uuid: string;
  slug: string;
  title: string;
  indexed_at: string;
}

interface AuthoritativeVersion {
  block_uuid: string;
  version_uuid: string;
  indexed_at: string;
}

interface BlockResultRow {
  body: string;
}

const BlockViewPage: React.FC = () => {
  const [content, setContent] = useState<string>('')
  const [title, setTitle] = useState<string>('')
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { client } = useTributary()
  
  // Extract the streamId and slug from params
  const { prefix, slug } = useParams()

  useEffect(() => {
    const loadDocument = async () => {
      if (!client || !prefix || !slug) {
        setError('Missing required parameters')
        setIsLoading(false)
        return
      }

      try {
        // Extract streamId from prefix (format: base64url-public-key)
        const streamId = prefix
        
        // Get the stream
        const stream = await client.get('scribe', streamId)
        
        if (!stream) {
          throw new Error('Failed to get stream')
        }
        
        // Create local database for querying
        const localDb = stream.local()
        
        // Import scribe-data functions
        const { getBlockBySlug, getAuthoritativeVersionByBlockUuid } = await import('scribe-data')
        
        // Get the block slug info
        const blockSlugInfo = await getBlockBySlug(localDb, slug) as BlockSlugInfo | null
        
        if (!blockSlugInfo) {
          throw new Error('Document not found')
        }
        
        // Get the authoritative version
        const authoritativeVersion = await getAuthoritativeVersionByBlockUuid(localDb, blockSlugInfo.block_uuid) as AuthoritativeVersion | null
        
        if (!authoritativeVersion) {
          throw new Error('Document version not found')
        }
        
        // Get the actual block content
        const blockResult = await localDb.query(
          `SELECT body FROM block WHERE block_uuid = $1 AND version_uuid = $2`,
          [blockSlugInfo.block_uuid, authoritativeVersion.version_uuid]
        )
        
        if (!blockResult.rows || blockResult.rows.length === 0) {
          throw new Error('Document content not found')
        }
        
        const blockContent = (blockResult.rows[0] as BlockResultRow).body
        
        setContent(blockContent)
        setTitle(blockSlugInfo.title || slug || '')
      } catch (err: any) {
        setError('Failed to load document: ' + (err.message || 'Unknown error'))
        console.error('Error loading document:', err)
      } finally {
        setIsLoading(false)
      }
    }

    loadDocument()
  }, [client, prefix, slug])

  const handleEdit = () => {
    if (prefix && slug) {
      navigate(`/pk/${prefix}/${slug}/edit`)
    }
  }

  const handleNewDocument = () => {
    if (prefix) {
      navigate(`/pk/${prefix}/new`)
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
        <button 
          onClick={() => prefix ? navigate(`/pk/${prefix}/`) : navigate('/')}
          className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
        >
          Back to Home
        </button>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{title}</h1>
        <div className="space-x-2">
          <button 
            onClick={handleEdit}
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
          >
            Edit
          </button>
          <button 
            onClick={handleNewDocument}
            className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
          >
            New Document
          </button>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow-md p-6">
        <div 
          className="prose max-w-none prose-headings:font-bold prose-h1:text-3xl prose-h2:text-2xl prose-h3:text-xl prose-p:mb-4 prose-ul:list-disc prose-ol:list-decimal prose-li:mb-1 prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-gray-800 prose-pre:text-white prose-pre:p-4 prose-pre:overflow-x-auto prose-a:text-blue-600 prose-a:hover:underline"
          dangerouslySetInnerHTML={{ __html: micromark(content) }}
        />
      </div>
    </div>
  )
}

export default BlockViewPage
