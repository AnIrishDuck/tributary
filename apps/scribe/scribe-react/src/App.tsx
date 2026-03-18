import React, { useState, useEffect } from 'react'
import { RouterProvider, createHashRouter } from 'react-router'
import { routes } from './route'
import { TributaryProvider } from 'scribe-react-common/src/context/tributaryContext'
import { SyncStatusProvider } from 'scribe-react-common/src/context/syncStatusContext'
import { TributaryClient, TributaryServer, deriveAuthKey, deriveStreamSeed } from 'tributary-client'
import { createClient as createSupabaseClient, SupabaseClient, Session } from '@supabase/supabase-js'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { getPGlite, wipePGlite } from './db/persistence'
import { CONFIG } from './config'
import { fetchStorageServerUrl, clearStorageConfigCache } from './storageConfig'
import { ShieldCheckIcon, ExclamationCircleIcon, LockClosedIcon } from '@heroicons/react/24/outline'
import SetPasswordPage from './pages/SetPasswordPage'

// Create a Supabase auth client (only if project URL is configured).
// The default auth options (persistSession, autoRefreshToken, detectSessionInUrl
// all true) handle PWA lifecycle correctly — gotrue-js includes a built-in
// visibilitychange listener that refreshes tokens when the tab resumes.
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
// Uses real TributaryServer connecting to remote Supabase or a custom storage server
async function createTributaryClient(session: Session | null, storageServerUrl?: string | null) {
  // Return existing promise if already creating
  if (clientPromise) {
    return clientPromise
  }

  clientPromise = (async () => {
    const serverUrl = storageServerUrl || CONFIG.API_URL
    const server = new TributaryServer(serverUrl, CONFIG.API_KEY)

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

// localStorage key for the persisted root seed.  The root seed is equivalent to
// the signing private key — storing it in localStorage puts it on the same
// trust boundary as the Supabase refresh token that's already there.
const ROOT_SEED_STORAGE_KEY = 'scribe-root-seed'

function persistRootSeed(seed: Uint8Array) {
  localStorage.setItem(ROOT_SEED_STORAGE_KEY, base64url.encode(Buffer.from(seed)))
}

function loadPersistedRootSeed(): Uint8Array | null {
  const raw = localStorage.getItem(ROOT_SEED_STORAGE_KEY)
  if (!raw) return null
  return new Uint8Array(base64url.decode(raw))
}

function clearPersistedRootSeed() {
  localStorage.removeItem(ROOT_SEED_STORAGE_KEY)
}

// Check whether a Supabase session has exceeded the configurable expiry
// window. Supabase tracks `created_at` on every session (epoch seconds).
// We compare that against CONFIG.SESSION_EXPIRY_SECONDS so operators can
// extend sessions to e.g. one week for PWA use.
function isSessionExpired(session: Session): boolean {
  const createdAt = (session as any).created_at
  if (typeof createdAt !== 'number') return false
  const age = Math.floor(Date.now() / 1000) - createdAt
  return age > CONFIG.SESSION_EXPIRY_SECONDS
}

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

      // Derive root seed and keypair for home library registration.
      // Persist the root seed so PWA restarts can re-derive the key pair
      // without prompting for the password again.
      const rootSeed = await deriveStreamSeed(password, email, CONFIG.APP_ID)
      persistRootSeed(rootSeed)
      const keyPair = nacl.sign.keyPair.fromSeed(rootSeed)
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
  const [setupStep, setSetupStep] = useState<string | null>(null)

  // Logout: sign out of Supabase, wipe local DB, and reset client state.
  // Always reset in-memory state even if the PGlite wipe fails, so the
  // user is never stuck with a stale client on next login.
  async function logout() {
    clearPersistedRootSeed()
    clearStorageConfigCache()
    if (supabaseAuth) {
      await supabaseAuth.auth.signOut()
    }
    try {
      await wipePGlite()
    } catch (err) {
      console.error('wipePGlite failed during logout:', err)
    }
    clientPromise = null
    setClient(null)
    setSession(null)
    setDerivedKeyPair(null)
  }

  // Listen for auth state changes
  useEffect(() => {
    if (!supabaseAuth) return

    // Get initial session
    supabaseAuth.auth.getSession().then(({ data: { session } }) => {
      if (session && isSessionExpired(session)) {
        // Persisted session has exceeded the configured expiry — force re-auth
        supabaseAuth!.auth.signOut()
        setSession(null)
      } else {
        setSession(session)
      }
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
        // If the user has configured a custom storage server, use it
        let storageUrl: string | null = null
        if (supabaseAuth && session) {
          storageUrl = await fetchStorageServerUrl(supabaseAuth, CONFIG.SUPABASE_PROJECT_URL)
        }
        const { client: newClient, server } = await createTributaryClient(session, storageUrl)
        if (mounted) {
          setClient(newClient)
        }

        // Keep write token fresh on session changes
        if (supabaseAuth) {
          // Proactively update token when Supabase auto-refreshes it
          const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange((_event, session) => {
            server.setWriteAuthToken(session?.access_token ?? undefined)
          })

          // Force-refresh the token when a 401 is received (e.g. after
          // the browser tab was suspended and auto-refresh didn't fire)
          server.setAuthTokenRefresher(async () => {
            const { data, error } = await supabaseAuth!.auth.refreshSession()
            if (error || !data.session) return undefined
            return data.session.access_token
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

  // Post-login home stream registration: re-derive and register the home key.
  // Updates setupStep so the UI can show progress during the multi-step process.
  // Includes a timeout to detect when the local database is stuck (e.g.
  // corrupted IndexedDB) so the user can recover instead of spinning forever.
  useEffect(() => {
    if (!client || !derivedKeyPair || !session) return

    let mounted = true
    let timedOut = false

    async function registerHomeKey() {
      const t0 = performance.now()
      const elapsed = () => `${(performance.now() - t0).toFixed(0)}ms`
      try {
        console.log(`[registerHomeKey] start`)
        if (mounted) setSetupStep('Registering encryption keys...')
        await client!.addWriteKey(CONFIG.APP_ID, derivedKeyPair!.secretKey)
        console.log(`[registerHomeKey] addWriteKey done at ${elapsed()}`)

        const existingHome = await client!.getHomeStream()
        console.log(`[registerHomeKey] getHomeStream done at ${elapsed()}, exists=${!!existingHome}`)
        if (!existingHome) {
          if (mounted) setSetupStep('Setting up your library...')
          const publicKeyBase64 = base64url.encode(Buffer.from(derivedKeyPair!.publicKey))
          await client!.setHomeStream(publicKeyBase64)
          console.log(`[registerHomeKey] setHomeStream done at ${elapsed()}`)
        }

        // Database setup completed — clear the stuck-database timeout before
        // starting sync, which can legitimately take a long time for large
        // streams without indicating a problem.
        clearTimeout(timeoutId)

        if (mounted) setSetupStep('Syncing your library...')
        const publicKeyBase64 = base64url.encode(Buffer.from(derivedKeyPair!.publicKey))
        const stream = await client!.get(CONFIG.APP_ID, publicKeyBase64)
        console.log(`[registerHomeKey] get stream done at ${elapsed()}, found=${!!stream}`)
        if (stream) {
          await stream.sync(1000)
          console.log(`[registerHomeKey] initial sync done at ${elapsed()}`)
        }
      } catch (err) {
        console.error(`[registerHomeKey] failed at ${elapsed()}:`, err)
      }

      if (mounted && !timedOut) {
        setSetupStep(null)
        setDerivedKeyPair(null)
      }
    }

    const timeoutId = setTimeout(() => {
      if (mounted) {
        timedOut = true
        console.error('[app] registerHomeKey timed out — local database may be stuck')
        setError(
          'Setup timed out. Your browser\'s local database may be corrupted. ' +
          'Try clearing site data for this origin, or close other tabs that may have this site open.'
        )
        setSetupStep(null)
        setDerivedKeyPair(null)
      }
    }, 15_000)

    registerHomeKey()

    return () => {
      mounted = false
      clearTimeout(timeoutId)
      setSetupStep(null)
    }
  }, [client, derivedKeyPair, session])

  // Recover from missing home stream without forcing re-login.
  // This happens when the page is refreshed (or the PWA resumes) before the
  // initial registerHomeKey flushes to IndexedDB — the Supabase session
  // survives (localStorage) but PGlite's writes are lost and derivedKeyPair
  // (React state) is gone.
  //
  // If we have a persisted root seed we can re-derive the key pair and
  // re-run registration without prompting for the password.  Only force
  // re-authentication as a last resort when no root seed is available.
  useEffect(() => {
    if (!client || derivedKeyPair || passwordRecovery) return

    let mounted = true

    client.getHomeStream().then(homeStream => {
      if (!homeStream && mounted) {
        const rootSeed = loadPersistedRootSeed()
        if (rootSeed) {
          console.info('[app] No home stream — restoring key pair from persisted root seed')
          const keyPair = nacl.sign.keyPair.fromSeed(rootSeed)
          setDerivedKeyPair(keyPair)
        } else {
          console.warn('[app] No home stream and no persisted root seed — forcing re-authentication')
          logout().then(() => window.location.reload())
        }
      }
    })

    return () => { mounted = false }
  }, [client, derivedKeyPair, passwordRecovery])

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

  // Show setup screen during initial account registration (registerHomeKey).
  // This prevents the main app from rendering with an empty DB, which would
  // flash "No libraries yet" before sync completes.
  if (derivedKeyPair) {
    const step = setupStep || (!client ? 'Connecting to Tributary...' : 'Preparing...')
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <div className="text-center">
          <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-6 animate-pulse">
            <ShieldCheckIcon className="w-8 h-8 text-blue-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Setting up Scribe</h2>
          <p className="text-gray-600 mb-6">{step}</p>
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    )
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
            <div className="flex flex-col gap-3">
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Try Again
              </button>
              <button
                onClick={async () => {
                  await logout()
                  window.location.reload()
                }}
                className="inline-flex items-center justify-center px-6 py-3 border border-gray-300 text-base font-medium rounded-lg shadow-sm text-gray-700 bg-white hover:bg-gray-50 transition-colors"
              >
                Clear Local Data &amp; Retry
              </button>
            </div>
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
      <TributaryProvider client={client} logout={logout}>
        <RouterProvider router={router} />
      </TributaryProvider>
    </SyncStatusProvider>
  )
}

export default App
