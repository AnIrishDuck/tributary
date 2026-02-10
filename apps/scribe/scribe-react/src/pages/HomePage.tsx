import React from 'react'
import { Link } from 'react-router'

const HomePage: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-center mb-8">Scribe - Encrypted Document Editor</h1>
        
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Welcome to Scribe</h2>
          <p className="text-gray-700 mb-4">
            Scribe is an end-to-end encrypted document editor that allows you to create and manage 
            your documents securely.
          </p>
          <p className="text-gray-700">
            Your documents are encrypted locally before being synced, ensuring that the server 
            cannot read your content.
          </p>
        </div>
        
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Get Started</h2>
          <p className="text-gray-700 mb-4">
            Create a new encrypted document stream or import an existing one.
          </p>
          <div className="flex flex-col md:flex-row space-y-2 md:space-y-0 md:space-x-4">
            <Link
              to="/new"
              className="bg-blue-500 hover:bg-blue-700 text-white text-center font-bold py-2 px-4 rounded"
            >
              Create New Stream
            </Link>
            <Link
              to="/import"
              className="bg-green-500 hover:bg-green-700 text-white text-center font-bold py-2 px-4 rounded"
            >
              Import Existing Stream
            </Link>
          </div>
        </div>
        
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4">Existing Streams</h2>
          <p className="text-gray-700">
            In a real implementation, this would show your existing document streams.
          </p>
        </div>
      </div>
    </div>
  )
}

export default HomePage
