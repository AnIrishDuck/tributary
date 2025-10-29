import React from 'react'
import { RouterProvider, createHashRouter } from 'react-router'
import { routes } from './route'
import { TributaryProvider, createTestTributaryClient } from './context/tributaryContext'

// In a real app, this would be a real client with a real server
// For now we'll set up a test client for testing
const { client: testClient } = createTestTributaryClient()

const router = createHashRouter(routes)

function App() {
  return (
    <TributaryProvider client={testClient}>
      <div className="min-h-screen bg-gray-50">
        <RouterProvider router={router} />
      </div>
    </TributaryProvider>
  )
}

export default App
