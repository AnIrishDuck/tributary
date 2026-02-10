import React from 'react'
import { Link } from 'react-router'
import { PlusIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

const HomePage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero Section */}
      <div className="relative bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="relative z-10 pb-8 bg-white sm:pb-16 md:pb-20 lg:max-w-2xl lg:w-full lg:pb-28 xl:pb-32">
            <svg
              className="hidden lg:block absolute right-0 inset-y-0 h-full w-48 text-white transform translate-x-1/2"
              fill="currentColor"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <polygon points="50,0 100,0 50,100 0,100" />
            </svg>
            <main className="mt-10 mx-auto max-w-7xl px-4 sm:mt-12 sm:px-6 md:mt-16 lg:mt-20 lg:px-8 xl:mt-28">
              <div className="sm:text-center lg:text-left">
                <h1 className="text-4xl tracking-tight font-extrabold text-gray-900 sm:text-5xl md:text-6xl">
                  <span className="block xl:inline">Scribe</span>{' '}
                  <span className="block text-blue-600 xl:inline">Encrypted Document Editor</span>
                </h1>
                <p className="mt-3 text-base text-gray-500 sm:mt-5 sm:text-lg sm:max-w-xl sm:mx-auto md:mt-5 md:text-xl lg:mx-0">
                  Create and manage your encrypted documents securely with end-to-end encryption. 
                  Your documents are encrypted locally before being synced, ensuring that the server 
                  cannot read your content.
                </p>
                <div className="mt-5 sm:mt-8 sm:flex sm:justify-center lg:justify-start">
                  <div className="rounded-md shadow">
                    <Link
                      to="/new"
                      className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 md:py-4 md:text-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                    >
                      <PlusIcon className="w-5 h-5 mr-2" />
                      Create New Stream
                    </Link>
                  </div>
                  <div className="mt-3 sm:mt-0 sm:ml-3">
                    <Link
                      to="/import"
                      className="w-full flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-lg text-blue-700 bg-blue-100 hover:bg-blue-200 md:py-4 md:text-lg transition-all duration-200"
                    >
                      <DocumentTextIcon className="w-5 h-5 mr-2" />
                      Import Existing Stream
                    </Link>
                  </div>
                </div>
              </div>
            </main>
          </div>
        </div>
        <div className="lg:absolute lg:inset-y-0 lg:right-0 lg:w-1/2">
          <div className="h-56 w-full bg-gradient-to-r from-blue-50 to-indigo-50 lg:h-full lg:w-full opacity-50"></div>
        </div>
      </div>

      {/* Features Section */}
      <div className="py-16 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="lg:text-center mb-16">
            <h2 className="text-base text-blue-600 font-semibold tracking-wide uppercase">Features</h2>
            <p className="mt-2 text-3xl leading-8 font-extrabold tracking-tight text-gray-900 sm:text-4xl">
              Secure. Private. Yours.
            </p>
            <p className="mt-4 max-w-2xl text-xl text-gray-500 lg:mx-auto">
              Scribe provides enterprise-grade security for your documents while maintaining a simple, intuitive interface.
            </p>
          </div>

          <div className="mt-10">
            <div className="space-y-10 md:space-y-0 md:grid md:grid-cols-3 md:gap-8">
              <div>
                <div className="flex justify-center">
                  <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-blue-100 text-blue-600">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                </div>
                <div className="mt-6 text-center">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">End-to-End Encryption</h3>
                  <p className="mt-2 text-base text-gray-500">
                    Your documents are encrypted locally before being synced, ensuring that the server cannot read your content.
                  </p>
                </div>
              </div>

              <div>
                <div className="flex justify-center">
                  <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-green-100 text-green-600">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                </div>
                <div className="mt-6 text-center">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Local Key Generation</h3>
                  <p className="mt-2 text-base text-gray-500">
                    Secure keys are generated locally on your device, ensuring you maintain complete control over your encryption.
                  </p>
                </div>
              </div>

              <div>
                <div className="flex justify-center">
                  <div className="flex items-center justify-center h-12 w-12 rounded-xl bg-purple-100 text-purple-600">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                </div>
                <div className="mt-6 text-center">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Sync Anywhere</h3>
                  <p className="mt-2 text-base text-gray-500">
                    Access your encrypted documents from any device while maintaining the same level of security.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Existing Streams Section */}
      <div className="bg-gray-50 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
              Manage Your Documents
            </h2>
            <p className="mt-4 text-xl text-gray-500">
              Create, edit, and organize your encrypted documents with ease.
            </p>
          </div>

          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
              <div className="px-8 py-6 border-b border-gray-100">
                <h3 className="text-xl font-semibold text-gray-900">Ready to get started?</h3>
                <p className="mt-2 text-gray-600">
                  Create a new encrypted document stream or import an existing one to begin managing your secure documents.
                </p>
              </div>
              <div className="px-8 py-6 bg-gray-50">
                <div className="grid grid-cols-1 gap-4">
                  <Link
                    to="/new"
                    className="flex items-center p-4 bg-white rounded-xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all duration-200 group"
                  >
                    <div className="flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-lg bg-blue-100 text-blue-600 group-hover:bg-blue-200">
                      <PlusIcon className="h-6 w-6" />
                    </div>
                    <div className="ml-4">
                      <h4 className="text-lg font-medium text-gray-900 group-hover:text-blue-600 transition-colors">Create New Stream</h4>
                      <p className="text-sm text-gray-500">Generate a new encrypted document stream</p>
                    </div>
                  </Link>
                  <Link
                    to="/import"
                    className="flex items-center p-4 bg-white rounded-xl border border-gray-200 hover:border-green-300 hover:shadow-md transition-all duration-200 group"
                  >
                    <div className="flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-lg bg-green-100 text-green-600 group-hover:bg-green-200">
                      <DocumentTextIcon className="h-6 w-6" />
                    </div>
                    <div className="ml-4">
                      <h4 className="text-lg font-medium text-gray-900 group-hover:text-green-600 transition-colors">Import Existing Stream</h4>
                      <p className="text-sm text-gray-500">Access an existing encrypted stream</p>
                    </div>
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

export default HomePage
