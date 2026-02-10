import React, { useState, FormEvent } from 'react'
import { useNavigate, Link } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { importStream } from '../actions/importStream'
import { DocumentTextIcon } from '@heroicons/react/24/outline'

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
    <div className="min-h-screen bg-gray-50 py-12">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Import Existing Stream</h1>
            <p className="text-gray-600">
              Access your encrypted documents using your private key
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Left side - Form */}
            <div className="p-8 lg:p-10">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-3">Import Stream</h2>
                <p className="text-gray-600">
                  Import an existing stream by entering its private key. You can also import a stream via a shared link.
                </p>
              </div>
              
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label 
                    htmlFor="privateKey" 
                    className="block text-sm font-semibold text-gray-700 mb-2"
                  >
                    Private Key
                  </label>
                  <div className="relative rounded-lg shadow-sm">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <DocumentTextIcon className="h-5 w-5 text-gray-400" />
                    </div>
                    <textarea
                      id="privateKey"
                      rows={6}
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      className={`
                        block w-full rounded-lg border-gray-300 pl-10 pr-3
                        py-3 text-base
                        focus:ring-2 focus:ring-blue-500 focus:border-blue-500
                        ${error ? 'border-red-300 focus:ring-red-500' : 'border-gray-300'}
                        shadow-sm transition-colors duration-200 resize-none
                      `}
                      placeholder="Enter your private key (base64url encoded)"
                    />
                  </div>
                  <p className="mt-2 text-sm text-gray-500">
                    This is your private write key for accessing an existing stream
                  </p>
                  {error && (
                    <p className="mt-2 text-sm text-red-600 flex items-center animate-fade-in">
                      <svg className="w-4 h-4 mr-1.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {error}
                    </p>
                  )}
                </div>
                
                <div className="pt-6">
                  <button
                    type="submit"
                    disabled={loading}
                    className={`w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed ${
                      loading ? 'cursor-wait' : ''
                    }`}
                  >
                    {loading ? (
                      <span className="flex items-center justify-center">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Importing...
                      </span>
                    ) : (
                      'Import Stream'
                    )}
                  </button>
                </div>
              </form>
              
              <div className="mt-8 pt-6 border-t border-gray-100 text-center">
                <p className="text-gray-600 text-sm">
                  <Link
                    to="/new"
                    className="text-blue-600 hover:text-blue-800 font-medium hover:underline"
                  >
                    Or create a new stream
                  </Link>
                </p>
              </div>
            </div>
            
            {/* Right side - Help */}
            <div className="bg-gray-50 p-8 lg:p-10">
              <h3 className="text-xl font-bold text-gray-900 mb-6">Share Access</h3>
              
              <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
                <h4 className="font-semibold text-gray-900 mb-3">To share access to your stream, create a link with your write key.</h4>
                <p className="text-sm text-gray-600 mb-4">
                  Format:
                </p>
                <code className="block bg-gray-900 text-gray-50 px-4 py-3 rounded-lg text-sm font-mono break-all">
                  yourapp.com/#pk/[publicKey]/grant/write/[privateKey]
                </code>
              </div>
              
              <div>
                <h4 className="font-semibold text-gray-900 mb-4">Quick Actions</h4>
                <div className="space-y-3">
                  <Link
                    to="/"
                    className="flex items-center p-3 bg-white rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-sm transition-all duration-200 text-gray-700 hover:text-blue-600"
                  >
                    <svg className="w-5 h-5 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                    <span className="font-medium">Back to Home</span>
                  </Link>
                  
                  <Link
                    to="/import"
                    className="flex items-center p-3 bg-white rounded-lg border border-gray-200 hover:border-green-300 hover:shadow-sm transition-all duration-200 text-gray-700 hover:text-green-600"
                  >
                    <DocumentTextIcon className="w-5 h-5 mr-3" />
                    <span className="font-medium">Import Another Stream</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ImportStreamPage
