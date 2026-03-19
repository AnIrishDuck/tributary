import React, { createContext, useContext, ReactNode } from 'react'
import { TributaryClient, createTestServer, type Server } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'

/** Minimal session info exposed to the app. */
export interface AccountSession {
  email: string | undefined
}

// Define the context type
interface TributaryContextType {
  client: TributaryClient | null
  server: Server | null
  logout: (() => Promise<void>) | null
  clearAccount: (() => Promise<void>) | null
  session: AccountSession | null
}

// Create the context with default value
const TributaryContext = createContext<TributaryContextType>({
  client: null,
  server: null,
  logout: null,
  clearAccount: null,
  session: null,
})

// Create a provider component
interface TributaryProviderProps {
  client: TributaryClient | null
  server?: Server | null
  logout?: (() => Promise<void>) | null
  clearAccount?: (() => Promise<void>) | null
  session?: AccountSession | null
  children: ReactNode
}

export const TributaryProvider: React.FC<TributaryProviderProps> = ({ client, server, logout, clearAccount, session, children }) => {
  return (
    <TributaryContext.Provider value={{ client, server: server ?? null, logout: logout ?? null, clearAccount: clearAccount ?? null, session: session ?? null }}>
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
