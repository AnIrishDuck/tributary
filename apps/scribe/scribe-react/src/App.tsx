import React, { useState, useEffect } from 'react'
import { RouterProvider, createHashRouter } from 'react-router'
import { routes } from './route'
import { TributaryProvider } from './context/tributaryContext'
import { SyncStatusProvider } from './context/syncStatusContext'
import { TributaryClient, TributaryServer, deriveAuthKey, deriveStreamSeed } from 'tributary-client'
import { createClient as createSupabaseClient, SupabaseClient, Session } from '@supabase/supabase-js'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { getPGlite } from './db/persistence'
import { CONFIG } from './config'
import { ShieldCheckIcon, ExclamationCircleIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import SetPasswordPage from './pages/SetPasswordPage'

// Create a Supabase auth client (only if project URL is configured)
let supabaseAuth: SupabaseClient | null = null
if (CONFIG.SUPABASE_PROJECT_URL && CONFIG.API_KEY) {
  supabaseAuth = createSupabaseClient(CONFIG.SUPABASE_PROJECT_URL, CONFIG.API_KEY)
}

// Detect password recovery redirect before Supabase processes the hash.
// Supabase redirects back with: #access_token=xxx&type=recovery
// The PASSWORD_RECOVERY event fires during createSupabaseClient() above,
// before any React listener is registered, so we detect it here instead.
const initialPasswordRecovery = window.location.hash.includes('type=recovery')

// Singleton to prevent multiple PGlite instances (WASM can only load once)
let clientPromise: Promise<{ client: TributaryClient; server: TributaryServer }> | null = null

// Create client based on configuration
// Uses real TributaryServer connecting to remote Supabase
async function createTributaryClient(session: Session | null) {
  // Return existing promise if already creating
  if (clientPromise) {
    return clientPromise
  }

  clientPromise = (async () => {
    const server = new TributaryServer(CONFIG.API_URL, CONFIG.API_KEY)

    if (session?.access_token) {
      server.setWriteAuthToken(session.access_token)
    }

    // Use IndexedDB for persistence
    const pglite = getPGlite(CONFIG.DB_NAME)

    return { client: new TributaryClient({ server, db: pglite }), server }
  })()

  return clientPromise
}

const router = createHashRouter(routes)

interface DerivedKeyPair {
  publicKey: Uint8Array
  secretKey: Uint8Array
}

// Login screen shown when Supabase auth is configured but user is not signed in
function LoginScreen({ onDerivedKeyPair }: { onDerivedKeyPair: (kp: DerivedKeyPair) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabaseAuth) return
    setLoading(true)
    setError(null)

    try {
      // Derive auth key from password
      const authKey = await deriveAuthKey(password, email)
      const { error: signInError } = await supabaseAuth.auth.signInWithPassword({ email, password: authKey })
      if (signInError) {
        setError(signInError.message)
        setLoading(false)
        return
      }

      // Derive stream seed and keypair for home library registration
      const streamSeed = await deriveStreamSeed(password, email, CONFIG.APP_ID)
      const keyPair = nacl.sign.keyPair.fromSeed(streamSeed)
      onDerivedKeyPair(keyPair)
    } catch (err: any) {
      setError(err.message || 'Login failed')
    }
    setLoading(false)
  }

  async function handleForgotPassword(e: React.MouseEvent) {
    e.preventDefault()
    if (!supabaseAuth || !email) {
      setError('Please enter your email address first')
      return
    }
    setLoading(true)
    setError(null)

    const { error } = await supabaseAuth.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    })
    if (error) {
      setError(error.message)
    } else {
      setResetSent(true)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
      <div className="max-w-sm w-full">
        <div className="card p-8">
          <div className="text-center mb-6">
            <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <LockClosedIcon className="w-6 h-6 text-blue-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Sign in to Scribe</h1>
          </div>
          {resetSent ? (
            <div className="text-center">
              <p className="text-sm text-gray-700">Check your email for a password reset link.</p>
            </div>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
            <div className="text-center">
              <a
                href="#"
                onClick={handleForgotPassword}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Forgot password?
              </a>
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  )
}

function App() {
  const [client, setClient] = useState<TributaryClient | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabaseAuth) // skip auth gate if no supabase auth
  const [error, setError] = useState<string | null>(null)
  const [passwordRecovery, setPasswordRecovery] = useState(initialPasswordRecovery)
  const [derivedKeyPair, setDerivedKeyPair] = useState<DerivedKeyPair | null>(null)

  // Listen for auth state changes
  useEffect(() => {
    if (!supabaseAuth) return

    // Get initial session
    supabaseAuth.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthReady(true)
    })

    const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange((event, session) => {
      setSession(session)
      setAuthReady(true)
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // Initialize tributary client once we have a session (or auth is not configured)
  useEffect(() => {
    if (!authReady) return
    // If auth is configured, require a session before initializing
    if (supabaseAuth && !session) return

    let mounted = true

    async function init() {
      try {
        const { client: newClient, server } = await createTributaryClient(session)
        if (mounted) {
          setClient(newClient)
        }

        // Keep write token fresh on session changes
        if (supabaseAuth) {
          const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange((_event, session) => {
            server.setWriteAuthToken(session?.access_token ?? undefined)
          })
          return () => subscription.unsubscribe()
        }
      } catch (err) {
        if (mounted) {
          setError(`Failed to initialize client: ${err}`)
        }
      }
    }

    let unsubscribe: (() => void) | undefined
    init().then(cleanup => {
      unsubscribe = cleanup
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [authReady, session])

  // Post-login home stream registration: re-derive and register the home key
  useEffect(() => {
    if (!client || !derivedKeyPair || !session) return

    let mounted = true

    async function registerHomeKey() {
      try {
        // Register the derived key with the client
        await client!.addWriteKey(CONFIG.APP_ID, derivedKeyPair!.secretKey)

        // Set home stream if not already set
        const existingHome = await client!.getHomeStream()
        if (!existingHome) {
          const publicKeyBase64 = base64url.encode(Buffer.from(derivedKeyPair!.publicKey))
          await client!.setHomeStream(publicKeyBase64)
        }

        // Sync the home stream
        const publicKeyBase64 = base64url.encode(Buffer.from(derivedKeyPair!.publicKey))
        const stream = await client!.get(CONFIG.APP_ID, publicKeyBase64)
        if (stream) {
          await stream.sync(1000)
        }
      } catch (err) {
        console.error('Failed to register home key:', err)
      }

      if (mounted) {
        setDerivedKeyPair(null)
      }
    }

    registerHomeKey()

    return () => {
      mounted = false
    }
  }, [client, derivedKeyPair, session])

  // Show SetPasswordPage during password recovery flow (wait for client to be ready)
  if (passwordRecovery && session && supabaseAuth && client) {
    return (
      <SetPasswordPage
        supabase={supabaseAuth}
        session={session}
        client={client}
        onComplete={() => setPasswordRecovery(false)}
      />
    )
  }

  // Show login screen if auth is configured but user is not signed in
  if (supabaseAuth && authReady && !session) {
    return <LoginScreen onDerivedKeyPair={setDerivedKeyPair} />
  }

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
        <RouterProvider router={router} />
      </TributaryProvider>
    </SyncStatusProvider>
  )
}

export default App
