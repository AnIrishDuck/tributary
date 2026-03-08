// Configuration for scribe-react
// Server URL can be set via environment variable or defaults to localhost

// Default session expiry: 1 week in seconds
const DEFAULT_SESSION_EXPIRY_SECONDS = 7 * 24 * 60 * 60

export const CONFIG = {
  // API URL for the tributary server
  // In production, this should be set via import.meta.env.VITE_API_URL
  API_URL: import.meta.env.VITE_API_URL || 'http://localhost:3001',

  // Optional API key for server authentication (e.g., Supabase anon key)
  API_KEY: import.meta.env.VITE_API_KEY || undefined,

  // Supabase project URL (base URL, not edge function URL)
  // Used for auth client to obtain JWTs for write access
  SUPABASE_PROJECT_URL: import.meta.env.VITE_SUPABASE_PROJECT_URL || undefined,

  // Database name for IndexedDB persistence
  DB_NAME: 'scribe-db',

  // Application ID for scribe libraries
  APP_ID: 'scribe',

  // Session expiry in seconds. Controls how long a persisted session remains
  // valid before requiring re-authentication. Defaults to 1 week (604800s).
  // Set via VITE_SESSION_EXPIRY_SECONDS to override.
  SESSION_EXPIRY_SECONDS: Number(import.meta.env.VITE_SESSION_EXPIRY_SECONDS) || DEFAULT_SESSION_EXPIRY_SECONDS,
} as const
