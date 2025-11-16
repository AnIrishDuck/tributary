import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { importStream } from '../actions/importStream'

/**
 * Page for handling the grant/write route with an encoded private key
 * This route is used when a user receives a link with an encoded private key
 */
const GrantWriteAccessPage: React.FC = () => {
  const { client } = useTributary()
  const { prefix, encodedPrivateKey } = useParams<{ prefix: string, encodedPrivateKey: string }>()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [errorMessage, setErrorMessage] = useState('')
  const navigate = useNavigate()

  // Process the private key on mount
  useEffect(() => {
    if (!client || !encodedPrivateKey || !prefix) {
      setStatus('error')
      setErrorMessage('Missing required parameters')
      return
    }

    const importKey = async () => {
      try {
        // Import the stream using the provided key
        const { prefix: newPrefix } = await importStream(client, encodedPrivateKey)
        
        // Set success and prepare to redirect
        setStatus('success')
        
        // Wait a moment to show the success message before redirecting
        setTimeout(() => {
          navigate(`#${newPrefix}/`)
        }, 1500)
      } catch (err) {
        console.error('Error importing stream:', err)
        setStatus('error')
        setErrorMessage((err as Error).message || 'Failed to import stream')
      }
    }

    importKey()
  }, [client, encodedPrivateKey, prefix, navigate])

  return (
    <div className="max-w-md mx-auto mt-10 p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6">Grant Write Access</h1>
      
      {status === 'loading' && (
        <div className="flex flex-col items-center justify-center py-4">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-gray-700">Processing write key...</p>
        </div>
      )}

      {status === 'success' && (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          <p className="font-bold">Access Granted!</p>
          <p>Write access has been saved to your local keyring.</p>
          <p className="mt-2">Redirecting you to the document collection...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <p className="font-bold">Error</p>
          <p>{errorMessage || 'An error occurred while processing the write key'}</p>
          <div className="mt-4">
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Return to Home
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default GrantWriteAccessPage
