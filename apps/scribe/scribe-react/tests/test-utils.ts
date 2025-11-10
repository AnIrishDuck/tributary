import { TributaryClient, TributaryStream } from 'tributary-client'
import { createStream } from '../src/actions/createStream'
import { createTestTributaryClient } from '../src/context/tributaryContext'

/**
 * Create a test client with a stream for testing
 * Returns the client, stream, and routing prefix
 */
export async function createTestClientWithStream(): Promise<{
  client: TributaryClient,
  stream: TributaryStream,
  streamId: string,
  prefix: string
}> {
  // Create test client (this uses createTestServer internally)
  const { client } = createTestTributaryClient()
  
  const { stream, prefix, streamId } = await createStream(client)
  
  return { client, stream, streamId, prefix }
}
