import React, { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { importStream } from '../actions/importStream'

const ImportStreamPage: React.FC = () => {
  const [privateKey, setPrivateKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { client } = useTributary()
  const navigate = useNavigate()

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    
    if (!client) {
      setError('Tributary client is not initialized')
      return
    }

    if (!privateKey.trim()) {
      setError('Private key is required')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Import the stream using the provided private key
      const { prefix } = await importStream(client, privateKey.trim())
      
      // Navigate to the stream's home page - Add console log for debugging
      console.log('Navigating to', `#${prefix}/`)
      // Make sure to return to the event loop before navigating
      setTimeout(() => {
        navigate(`#${prefix}/`)
      }, 0)
    } catch (err) {
      console.error('Error importing stream:', err)
      setError(`Failed to import stream: ${(err as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6">Import Existing Stream</h1>
      
      <div className="mb-6">
        <p className="text-gray-700">
          Import an existing stream by entering its private key. You can also import a stream via a shared link.
        </p>
      </div>
      
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label 
            htmlFor="privateKey" 
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Private Key
          </label>
          <input
            id="privateKey"
            type="text"
            value={privateKey}
            onChange={(e) => setPrivateKey(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter your private key (base64url encoded)"
          />
          <p className="mt-1 text-sm text-gray-500">
            This is your private write key for accessing an existing stream
          </p>
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-md">
            {error}
          </div>
        )}
        
        <button
          type="submit"
          disabled={loading}
          className="w-full px-4 py-2 text-white bg-blue-600 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-300"
        >
          {loading ? 'Importing...' : 'Import Stream'}
        </button>
      </form>
      
      <div className="mt-4 text-center">
        <a href="#new" className="text-blue-600 hover:underline">
          Or create a new stream
        </a>
      </div>
      
      <div className="mt-6 border-t border-gray-200 pt-4">
        <h2 className="text-lg font-medium mb-2">Share Access</h2>
        <p className="text-gray-700 text-sm mb-2">
          To share access to your stream, you can create a link with your write key.
        </p>
        <p className="text-gray-700 text-sm">
          Format: <code className="bg-gray-100 px-1">yourapp.com/#pk/[publicKey]/grant/write/[privateKey]</code>
        </p>
      </div>
    </div>
  )
}

export default ImportStreamPage
