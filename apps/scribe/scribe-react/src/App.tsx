import React, { useState, useEffect } from 'react'
import { RouterProvider, createHashRouter } from 'react-router'
import { routes } from './route'
import { TributaryProvider } from './context/tributaryContext'
import { SyncStatusProvider } from './context/syncStatusContext'
import { TributaryClient, TributaryServer } from 'tributary-client'
import { getPGlite } from './db/persistence'
import { CONFIG } from './config'
import { ShieldCheckIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'

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
    
    // Use IndexedDB for persistence
    const pglite = getPGlite(CONFIG.DB_NAME)
    
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="max-w-lg w-full">
          <div className="card p-8 text-center">
            <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
              <ExclamationCircleIcon className="w-8 h-8 text-red-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">Initialization Error</h1>
            <p className="text-gray-700 mb-6">{error}</p>
            <div className="bg-gray-50 rounded-lg p-4 text-left mb-6">
              <p className="text-xs text-gray-500 font-semibold mb-1">Server URL</p>
              <p className="text-sm font-mono text-gray-700 break-all">{CONFIG.API_URL}</p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6 animate-pulse">
            <ShieldCheckIcon className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Connecting to Tributary...</h2>
          <p className="text-gray-600 mb-6">Establishing secure connection</p>
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="text-sm text-gray-500 mt-6 font-mono">{CONFIG.API_URL}</p>
        </div>
      </div>
    )
  }

  return (
    <SyncStatusProvider client={client}>
      <TributaryProvider client={client}>
        <div className="min-h-screen bg-gray-50">
          <RouterProvider router={router} />
        </div>
      </TributaryProvider>
    </SyncStatusProvider>
  )
}

export default App
