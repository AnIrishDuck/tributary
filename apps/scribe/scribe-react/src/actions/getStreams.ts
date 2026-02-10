import { TributaryClient } from 'tributary-client'

/**
 * Get all streams tracked by the TributaryClient
 * @param client The TributaryClient instance
 * @returns Array of stream IDs (base64url encoded public keys)
 */
export async function getStreams(client: TributaryClient): Promise<string[]> {
  return await client.list()
}
