import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import * as base64url from 'urlsafe-base64'
import { micromark } from 'micromark'
import { PencilIcon, PlusIcon, ArrowLeftIcon } from '@heroicons/react/24/outline'
import { isSlugLink, resolveLink, isResolvedBlockUrl } from '../utils/links'

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

  const handleBack = () => {
    if (prefix) {
      navigate(`/pk/${prefix}/`)
    } else {
      navigate('/')
    }
  }

  // Post-process the rendered HTML to update links
  useEffect(() => {
    // Only run in browser environment
    if (typeof window === 'undefined') return
    
    // Get the content container
    const contentContainer = document.querySelector('.prose')
    if (!contentContainer) return
    
    // Find all anchor tags and update their href attributes
    const anchors = contentContainer.querySelectorAll('a')
    anchors.forEach(anchor => {
      const href = anchor.getAttribute('href')
      if (href) {
        // Check if this is a slug link (no protocol)
        if (isSlugLink(href) && !isResolvedBlockUrl(href)) {
          // Resolve the slug link to the proper block URL
          const resolvedHref = resolveLink(href, prefix || '', slug || '')
          console.log("DEBUG: setting href to:", resolvedHref);
          anchor.setAttribute('href', resolvedHref);
        }
      }
    })
  }, [prefix, slug, content])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600">Loading document...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-3xl mx-auto px-4">
          <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
            <div className="flex items-start">
              <svg className="w-6 h-6 text-red-500 mt-1 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <h3 className="text-lg font-medium text-red-900">Error loading document</h3>
                <p className="text-red-700 mt-1 text-sm">{error}</p>
              </div>
            </div>
          </div>
          <button 
            onClick={handleBack}
            className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors"
          >
            <ArrowLeftIcon className="w-4 h-4 mr-2" />
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-8 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <button 
                onClick={handleBack}
                className="text-sm text-gray-600 hover:text-blue-600 hover:bg-blue-50 px-3 py-2 rounded-lg transition-colors inline-flex items-center font-medium mb-3"
              >
                <ArrowLeftIcon className="w-4 h-4 mr-1.5" />
                Back to Documents
              </button>
              <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
              <p className="text-sm text-gray-500 mt-2">
                {new Date().toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </p>
            </div>
            
            <div className="flex items-center space-x-3">
              <button 
                onClick={handleEdit}
                className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <PencilIcon className="w-4 h-4 mr-2" />
                Edit
              </button>
              
              <button 
                onClick={handleNewDocument}
                className="inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <PlusIcon className="w-4 h-4 mr-2" />
                New Document
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden p-8 md:p-12">
          <div 
            className="prose prose-lg max-w-none"
            dangerouslySetInnerHTML={{ __html: micromark(content) }}
          />
        </div>
      </div>
    </div>
  )
}

export default BlockViewPage
