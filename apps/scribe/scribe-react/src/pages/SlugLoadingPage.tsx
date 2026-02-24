import React from 'react'

const SlugLoadingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-4">
      <div className="text-center">
        <div className="mx-auto w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-2"></div>
        <p className="text-sm text-gray-600">Loading...</p>
      </div>
    </div>
  )
}

export default SlugLoadingPage
