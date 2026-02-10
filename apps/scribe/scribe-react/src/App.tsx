import React, { useState, useEffect } from 'react'
import { RouterProvider, createHashRouter } from 'react-router'
import { routes } from './route'
import { TributaryProvider } from './context/tributaryContext'
import { TributaryClient, TributaryServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import { CONFIG } from './config'

// Singleton to prevent multiple PGlite instances (WASM can only load once)
let clientPromise: Promise<TributaryClient> | null = null

// Create client based on configuration
// Uses real TributaryServer connecting to remote Supabase
async function createClient() {
  // Return existing promise if already creating
  if (clientPromise) {
    return clientPromise
  }
  
  clientPromise = (async () => {
    const server = new TributaryServer(CONFIG.API_URL, CONFIG.API_KEY)
    
    // Use memory database for dev (IndexedDB has WASM bundling issues with Vite)
    const pglite = new PGlite('memory://')
    
    return new TributaryClient({ server, db: pglite })
  })()
  
  return clientPromise
}

const router = createHashRouter(routes)

function App() {
  const [client, setClient] = useState<TributaryClient | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    
    async function init() {
      try {
        const newClient = await createClient()
        if (mounted) {
          setClient(newClient)
        }
      } catch (err) {
        if (mounted) {
          setError(`Failed to initialize client: ${err}`)
        }
      }
    }
    
    init()
    
    return () => {
      mounted = false
    }
  }, [])

  if (error) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center">
        <div className="bg-white p-6 rounded-lg shadow-md max-w-md">
          <h1 className="text-xl font-bold text-red-600 mb-4">Initialization Error</h1>
          <p className="text-gray-700">{error}</p>
          <p className="text-sm text-gray-500 mt-4">
            Server URL: {CONFIG.API_URL}
          </p>
        </div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">Connecting to tributary server...</p>
          <p className="text-sm text-gray-400 mt-2">{CONFIG.API_URL}</p>
        </div>
      </div>
    )
  }

  return (
    <TributaryProvider client={client}>
      <div className="min-h-screen bg-gray-50">
        <RouterProvider router={router} />
      </div>
    </TributaryProvider>
  )
}

export default App
