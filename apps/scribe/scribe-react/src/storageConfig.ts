// Fetches the user's storage server configuration from the central server.
// Returns a custom storage server URL if configured, or null for the default.

import { SupabaseClient } from '@supabase/supabase-js'

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

    const baseUrl = supabaseProjectUrl.replace(/\/$/, '')
    const response = await fetch(`${baseUrl}/functions/v1/storage`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    })

    if (!response.ok) {
      console.warn('Failed to fetch storage config:', response.status)
      cachedUrl = null
      return null
    }

    const result = await response.json()
    cachedUrl = result.server_url ?? null
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
