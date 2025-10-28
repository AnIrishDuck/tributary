import React, { createContext, useContext, ReactNode } from 'react'
import { TributaryClient } from 'tributary-client'
import { FakeServer } from 'tributary-client/src/fakeServer.js'
import { PGlite } from '@electric-sql/pglite'

// Define the context type
interface TributaryContextType {
  client: TributaryClient | null
}

// Create the context with default value
const TributaryContext = createContext<TributaryContextType>({
  client: null
})

// Create a provider component
interface TributaryProviderProps {
  client: TributaryClient | null
  children: ReactNode
}

export const TributaryProvider: React.FC<TributaryProviderProps> = ({ client, children }) => {
  return (
    <TributaryContext.Provider value={{ client }}>
      {children}
    </TributaryContext.Provider>
  )
}

// Create a hook to use the context
export const useTributary = () => {
  const context = useContext(TributaryContext)
  if (!context) {
    throw new Error('useTributary must be used within a TributaryProvider')
  }
  return context
}

// Helper function to create a test client for testing
export const createTestTributaryClient = () => {
  const server = new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server, db: pglite })
  return { client, server }
}
