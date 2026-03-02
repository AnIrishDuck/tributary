import React, { useEffect, useState } from 'react'
import { useNavigate, Link, useParams } from 'react-router'
import { useTributary } from 'scribe-react-common/src/context/tributaryContext'
import { importLibrary } from 'scribe-data'
import { ShieldCheckIcon, ArrowRightIcon } from '@heroicons/react/24/outline'

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
        // Import the library using the provided key
        const { prefix: newPrefix } = await importLibrary(client, encodedPrivateKey)
        
        // Set success and prepare to redirect
        setStatus('success')
        
        // Wait a moment to show the success message before redirecting
        setTimeout(() => {
          navigate(`/${newPrefix}/`)
        }, 1500)
      } catch (err) {
        console.error('Error importing library:', err)
        setStatus('error')
        setErrorMessage((err as Error).message || 'Failed to import library')
      }
    }

    importKey()
  }, [client, encodedPrivateKey, prefix, navigate])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Grant Write Access</h1>
            
            {status === 'loading' && (
              <>
                <div className="mx-auto w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6 animate-pulse">
                  <ShieldCheckIcon className="w-10 h-10 text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900 mb-3">Processing...</h2>
                <p className="text-gray-600 mb-6">Granting write access to the library</p>
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
                <p className="text-sm text-gray-500">Please wait while we process your request</p>
              </>
            )}

            {status === 'success' && (
              <div className="animate-fade-in">
                <div className="mx-auto w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-6">
                  <ShieldCheckIcon className="w-10 h-10 text-green-600" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-3">Access Granted!</h2>
                <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-6">
                  <p className="text-green-800 text-sm">
                    Write access has been saved to your local keyring. You can now write to this library.
                  </p>
                </div>
                <p className="text-gray-600 mb-6">Redirecting you to the note collection...</p>
                <div className="inline-flex items-center text-blue-600 text-sm font-medium animate-pulse">
                  <span>Redirecting...</span>
                  <ArrowRightIcon className="w-4 h-4 ml-1.5" />
                </div>
              </div>
            )}

            {status === 'error' && (
              <div className="animate-fade-in">
                <div className="mx-auto w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mb-6">
                  <svg className="w-10 h-10 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-3">Error</h2>
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-6">
                  <p className="text-red-800 text-sm font-medium mb-2">Failed to process write key</p>
                  <p className="text-red-700 text-sm">{errorMessage || 'An error occurred while processing the write key'}</p>
                </div>
                <div className="flex justify-center space-x-3">
                  <button
                    onClick={() => navigate('/')}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                  >
                    Return to Home
                  </button>
                  <Link
                    to="/import"
                    className="px-6 py-3 bg-white text-gray-700 border border-gray-300 rounded-xl font-medium hover:bg-gray-50 transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
                  >
                    Try Again
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default GrantWriteAccessPage
