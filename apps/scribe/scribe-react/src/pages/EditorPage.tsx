import React, { useState, useEffect } from 'react'
import { useNavigate, useParams, Link } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { saveBlock } from '../actions/saveBlock'
import * as base64url from 'urlsafe-base64'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { BlockSlug, AuthoritativeVersion, Block } from 'scribe-data'
import { getBlockBySlug, getAuthoritativeVersionByBlockUuid, getBlockByVersion } from 'scribe-data'
import { ArrowUpOnSquareIcon, XMarkIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

const EditorPage: React.FC = () => {
  const [content, setContent] = useState<string>('# New Document\n\nStart writing here...')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [blockUuid, setBlockUuid] = useState<string | undefined>(undefined)
  const navigate = useNavigate()
  const { client } = useTributary()
  
  // Extract the streamId and optional slug id from params
  const { prefix, slug } = useParams()

  // Determine if this is a new document:
  // - For /pk/:prefix/new route, slug is undefined
  // - For /pk/:prefix/:slug/edit route, slug is the document slug
  const isNewDocument = !slug || slug === 'new'

  // If editing an existing document, we would load it here
  useEffect(() => {
    const loadDocumentForEditing = async () => {
      if (!isNewDocument && slug && slug !== 'new' && client && prefix) {
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
          
          // Get the block slug info
          const blockSlugInfo = await getBlockBySlug(localDb, slug) as BlockSlug | null
          
          if (!blockSlugInfo) {
            throw new Error('Document not found')
          }
          
          // Store the block UUID for updates
          setBlockUuid(blockSlugInfo.block_uuid)
          
          // Get the authoritative version
          const authoritativeVersion = await getAuthoritativeVersionByBlockUuid(localDb, blockSlugInfo.block_uuid) as AuthoritativeVersion | null
          
          if (!authoritativeVersion) {
            throw new Error('Document version not found')
          }
          
          // Get the actual block content using scribe-data functions
          const block = await getBlockByVersion(localDb, blockSlugInfo.block_uuid, authoritativeVersion.version_uuid)
          
          if (!block) {
            throw new Error('Document content not found')
          }
          
          setContent(block.body)
        } catch (err: any) {
          setError('Failed to load document: ' + (err.message || 'Unknown error'))
          console.error('Error loading document:', err)
        }
      }
    }

    loadDocumentForEditing()
  }, [isNewDocument, slug, client, prefix])

  const onSaveBlock = async () => {
    if (!client) {
      setError('Tributary client not available')
      return
    }

    setIsLoading(true)
    setError(null)
    
    try {
      // Extract streamId from prefix (format: base64url-public-key)
      if (!prefix) {
        throw new Error('No stream prefix provided')
      }
      
      // The prefix is already the base64url-public-key part
      const streamId = prefix
      
      // Assuming app ID is 'scribe' based on NewStreamPage
      const stream = await client.get('scribe', streamId)
      
      if (!stream) {
        throw new Error('Failed to get stream')
      }
      
      const { block, blockSlug: blockSlugResult } = await saveBlock(stream, content, 'web-ui', blockUuid)
      
      // After saving, navigate to the document view using the slug
      if (prefix) {
        // Type assertion since saveBlock returns blockSlug as any
        const slug = (blockSlugResult as any)?.slug
        if (slug && typeof slug === 'string') {
          navigate(`/pk/${prefix}/${slug}`)
        } else {
          navigate(`/pk/${prefix}/`)
        }
      } else {
        navigate('/')
      }
    } catch (err: any) {
      setError('Failed to save document: ' + (err.message || 'Unknown error'))
      console.error('Error saving document:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-3 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">
                {isNewDocument ? 'New Document' : 'Edit Document'}
              </h1>
            </div>
            
            <div className="flex items-center space-x-2">
              <button 
                onClick={() => prefix ? navigate(`/pk/${prefix}/`) : navigate('/')}
                className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200"
              >
                <XMarkIcon className="w-4 h-4 mr-1.5" />
                Cancel
              </button>
              
              <button 
                onClick={onSaveBlock}
                disabled={isLoading}
                className={`inline-flex items-center px-4 py-1.5 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white ${
                  isLoading 
                    ? 'bg-blue-400 cursor-not-allowed' 
                    : 'bg-blue-600 hover:bg-blue-700'
                } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all duration-200`}
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-1.5 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </>
                ) : (
                  <>
                    <ArrowUpOnSquareIcon className="w-4 h-4 mr-1.5" />
                    {isNewDocument ? 'Add Document' : 'Update Document'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        {error && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 animate-fade-in">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-red-600 mt-0.5 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <p className="text-sm text-red-700 mt-1">{error}</p>
              </div>
            </div>
          </div>
        )}
        
        <div className="card shadow-lg overflow-hidden flex flex-col h-[calc(100vh-250px)]">
          <div className="flex-1 overflow-hidden">
            <CodeMirror
              value={content}
              className="border-0 rounded-b-xl !bg-white w-full h-full"
              style={{
                fontSize: '14px',
                fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace'
              }}
              extensions={[markdown({ base: markdownLanguage, codeLanguages: languages })]}
              onChange={(value) => setContent(value)}
            />
          </div>
          
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <div className="flex items-center text-sm text-gray-500">
              <DocumentTextIcon className="w-4 h-4 mr-2" />
              <span>{content.length} characters</span>
            </div>
            <div className="text-xs text-gray-400">
              Markdown supported
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default EditorPage
