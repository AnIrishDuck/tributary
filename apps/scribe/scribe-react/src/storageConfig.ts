// Thin caching wrapper around the shared fetchStorageServerUrl.
// The cache lives for the browser session — call clearStorageConfigCache() on logout.

import { SupabaseClient } from '@supabase/supabase-js'
import { fetchStorageServerUrl as fetchUrl } from 'tributary-client'

let cachedUrl: string | null | undefined = undefined

/**
 * Fetch the user's custom storage server URL from the central server.
 * Returns null if the user has not configured a custom server (use default).
 * Caches the result for the session — call clearStorageConfigCache() on logout.
 */
export async function fetchStorageServerUrl(
  supabase: SupabaseClient,
  supabaseProjectUrl: string | undefined,
): Promise<string | null> {
  if (cachedUrl !== undefined) {
    return cachedUrl
  }

  if (!supabaseProjectUrl) {
    cachedUrl = null
    return null
  }

  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      cachedUrl = null
      return null
    }

    cachedUrl = await fetchUrl(supabaseProjectUrl, session.access_token)
    return cachedUrl
  } catch (e) {
    console.warn('Error fetching storage config:', e)
    cachedUrl = null
    return null
  }
}

/**
 * Clear the cached storage config. Call on logout.
 */
export function clearStorageConfigCache(): void {
  cachedUrl = undefined
}
