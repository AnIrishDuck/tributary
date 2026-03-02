import React, { createContext, useContext, ReactNode } from 'react'
import { TributaryClient, createTestServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'

// Define the context type
interface TributaryContextType {
  client: TributaryClient | null
  logout: (() => Promise<void>) | null
}

// Create the context with default value
const TributaryContext = createContext<TributaryContextType>({
  client: null,
  logout: null,
})

// Create a provider component
interface TributaryProviderProps {
  client: TributaryClient | null
  logout?: (() => Promise<void>) | null
  children: ReactNode
}

export const TributaryProvider: React.FC<TributaryProviderProps> = ({ client, logout, children }) => {
  return (
    <TributaryContext.Provider value={{ client, logout: logout ?? null }}>
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
  const server = createTestServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server, db: pglite })
  return { client, server }
}
