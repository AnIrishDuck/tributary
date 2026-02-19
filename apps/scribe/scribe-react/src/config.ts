// Configuration for scribe-react
// Server URL can be set via environment variable or defaults to localhost

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

  // Application ID for scribe streams
  APP_ID: 'scribe',
} as const
