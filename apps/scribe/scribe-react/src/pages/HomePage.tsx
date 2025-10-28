import React from 'react'

const HomePage: React.FC = () => {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Scribe Documents</h1>
      <div className="bg-white rounded-lg shadow-md p-6">
        <p className="text-gray-700 mb-4">
          Welcome to Scribe, your end-to-end encrypted document editor.
        </p>
        <div className="flex space-x-4">
          <button className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">
            Create New Document
          </button>
          <button className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded">
            Import Stream
          </button>
        </div>
      </div>
    </div>
  )
}

export default HomePage
