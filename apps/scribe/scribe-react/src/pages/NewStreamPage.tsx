import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router'
import { useTributary } from '../context/tributaryContext'
import { createStream } from '../actions/createStream'
import { ShieldCheckIcon } from '@heroicons/react/24/outline'

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
    <div className="min-h-screen bg-gray-50 py-12">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 py-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Create New Scribe Stream</h1>
            <p className="text-gray-600">
              Generate a new encrypted document stream with secure keys
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-2">
            {/* Left side - Information */}
            <div className="p-8 lg:p-10">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Stream Information</h2>
              
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-3">About This Stream</h3>
                  <p className="text-gray-600 leading-relaxed">
                    Create a new encrypted document stream. This will generate a new key pair 
                    for end-to-end encryption of your documents.
                  </p>
                </div>
                
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-6">
                  <h3 className="font-semibold text-blue-900 mb-4 flex items-center">
                    <ShieldCheckIcon className="w-5 h-5 mr-2" />
                    Security Features
                  </h3>
                  <ul className="space-y-3">
                    <li className="flex items-start">
                      <svg className="w-5 h-5 text-green-500 mt-0.5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm text-blue-800">End-to-end encryption with local key generation</span>
                    </li>
                    <li className="flex items-start">
                      <svg className="w-5 h-5 text-green-500 mt-0.5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm text-blue-800">Server never has access to your unencrypted content</span>
                    </li>
                    <li className="flex items-start">
                      <svg className="w-5 h-5 text-green-500 mt-0.5 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm text-blue-800">Secure key management with base64url encoding</span>
                    </li>
                  </ul>
                </div>
                
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 animate-fade-in">
                    <div className="flex items-start">
                      <svg className="w-5 h-5 text-red-600 mt-0.5 mr-2.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      <div>
                        <p className="font-semibold text-red-900">Error</p>
                        <p className="text-sm text-red-700 mt-1">{error}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Right side - Action */}
            <div className="bg-gradient-to-br from-blue-600 to-indigo-700 text-white p-8 lg:p-10 flex flex-col justify-center">
              <h3 className="text-2xl font-bold mb-6">Ready to create?</h3>
              <p className="text-blue-100 text-lg mb-8 leading-relaxed">
                Click the button below to generate a new encrypted stream with secure keys. Your data will be protected from the moment it's created.
              </p>
              
              <button
                onClick={onCreateStream}
                disabled={isLoading}
                className={`w-full bg-white text-blue-700 hover:bg-blue-50 font-semibold py-4 px-6 rounded-xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1 hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-lg ${
                  isLoading ? 'cursor-wait' : ''
                }`}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-3 h-6 w-6 text-blue-700" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Creating...
                  </span>
                ) : (
                  'Create New Stream'
                )}
              </button>
              
              <div className="mt-8 pt-8 border-t border-blue-500/30">
                <p className="text-sm text-blue-100">
                  Already have a stream?{' '}
                  <Link
                    to="/import"
                    className="text-white font-semibold hover:underline inline-flex items-center"
                  >
                    Import existing key
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default NewStreamPage
