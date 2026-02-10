import React, { useState } from 'react'
import { useNavigate } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { createStream } from '../actions/createStream'

const NewStreamPage: React.FC = () => {
  const navigate = useNavigate()
  const { client } = useTributary()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onCreateStream = async () => {
    if (!client) {
      setError('Tributary client not available')
      return
    }

    setIsLoading(true)
    setError(null)
    
    try {
      const { prefix } = await createStream(client)
      
      // Navigate to the new stream
      // The prefix is already formatted as "pk/<key>" where key is base64url encoded
      // (already URL-safe, no encoding needed). We must NOT encode the entire prefix
      // because that would turn "/pk/" into "/pk%2F" which breaks route matching.
      navigate(`/${prefix}/`)
    } catch (err: any) {
      setError('Failed to create new stream. Please try again.')
      console.error('Error creating new stream:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-6">
        <h1 className="text-2xl font-bold mb-6 text-center">Create New Scribe Stream</h1>
        
        <div className="mb-6">
          <p className="text-gray-700 mb-4">
            Create a new encrypted document stream. This will generate a new key pair 
            for end-to-end encryption of your documents.
          </p>
          
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-4">
            <h3 className="font-bold text-blue-800 mb-2">Security Note</h3>
            <p className="text-blue-700 text-sm">
              Your documents are encrypted locally before being synced. The server 
              cannot read your content.
            </p>
          </div>
        </div>
        
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        <button
          onClick={onCreateStream}
          disabled={isLoading}
          className={`w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded focus:outline-none focus:shadow-outline ${
            isLoading ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {isLoading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Creating Stream...
            </span>
          ) : (
            'Create New Stream'
          )}
        </button>
        
        <div className="mt-6 text-center">
          <p className="text-gray-600 text-sm">
            Already have a stream?{' '}
            <button 
              onClick={() => navigate('/')}
              className="text-blue-500 hover:text-blue-700 font-medium"
            >
              Import existing key
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

export default NewStreamPage
