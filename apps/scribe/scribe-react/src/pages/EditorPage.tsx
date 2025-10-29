import React, { useState, useEffect } from 'react'
import { useNavigate, useParams, useLoaderData } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { saveBlock } from '../actions/saveBlock'
import * as base64url from 'urlsafe-base64'
import CodeMirror from '@uiw/react-codemirror'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'

const EditorPage: React.FC = () => {
  const [content, setContent] = useState<string>('# New Document\n\nStart writing here...')
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { client } = useTributary()
  const loaderData = useLoaderData() as { isNew: boolean }
  
  // Extract the streamId and optional slug id from params
  const { prefix, slug } = useParams()

  const isNewDocument = loaderData.isNew

  // If editing an existing document, we would load it here
  useEffect(() => {
    if (slug && slug !== 'new') {
      // In a real implementation, we would load the existing document here
      // For now, we'll just set some placeholder content
      setContent(`# ${slug}\n\nLoading existing content...`)
    }
  }, [slug])

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
      
      const { block, blockSlug } = await saveBlock(stream, content)
      
      // After saving, navigate to the document view using the slug
      if (prefix) {
        if (blockSlug) {
          navigate(`/pk/${prefix}/${blockSlug.slug}`)
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
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">{isNewDocument ? 'New Document' : 'Edit Document'}</h1>
        <div className="space-x-2">
          <button 
            onClick={onSaveBlock}
            disabled={isLoading}
            className={`bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded ${
              isLoading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            data-testid="save-button"
          >
            {isLoading ? 'Saving...' : (isNewDocument ? 'Add' : 'Update')}
          </button>
          <button 
            onClick={() => prefix ? navigate(`/pk/${prefix}/`) : navigate('/')}
            className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded"
          >
            Cancel
          </button>
        </div>
      </div>
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4" data-testid="error-message">
          {error}
        </div>
      )}
      
      <div className="bg-white rounded-lg shadow-md p-6">
        <CodeMirror
          value={content}
          height="400px"
          extensions={[markdown({ base: markdownLanguage, codeLanguages: languages })]}
          onChange={(value) => setContent(value)}
          className="border border-gray-300 rounded-md"
        />
      </div>
    </div>
  )
}

export default EditorPage
