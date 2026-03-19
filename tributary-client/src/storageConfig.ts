// Fetches the user's storage server configuration from the central server.
// Shared between scribe-react and scribe-cli.

/**
 * Fetch the user's custom storage server URL from the central server.
 * Returns null if the user has not configured a custom server (use default).
 *
 * @param baseUrl - The Supabase project base URL (e.g. https://xyz.supabase.co)
 * @param accessToken - A valid Supabase JWT access token
 */
export async function fetchStorageServerUrl(
  baseUrl: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/functions/v1/storage`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      console.warn('Failed to fetch storage config:', response.status);
      return null;
    }

    const result = await response.json();
    return result.server_url ?? null;
  } catch (e) {
    console.warn('Error fetching storage config:', e);
    return null;
  }
}
