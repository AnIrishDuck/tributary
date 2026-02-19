import React from 'react'
import { TributaryClient, TributaryStream, Server } from 'tributary-client'
import { createStream } from '../src/actions/createStream'
import { createTestTributaryClient } from '../src/context/tributaryContext'
import { TributaryProvider } from '../src/context/tributaryContext'
import { SyncStatusProvider } from '../src/context/syncStatusContext'
import { TestFakeServer } from './test-server'

/**
 * Create a test client with a stream for testing
 * Returns the client, stream, and routing prefix
 * Backwards compatible: destructure only what you need
 */
export async function createTestClientWithStream(): Promise<{
  client: TributaryClient,
  stream: TributaryStream,
  streamId: string,
  prefix: string,
  server?: Server
}> {
  // Create test client (this uses createTestServer internally)
  const { client, server } = createTestTributaryClient()

  const { stream, prefix, streamId } = await createStream(client)

  // Return server only if it's a TestFakeServer for extended functionality
  const testServer = server as TestFakeServer | null
  return { client, stream, streamId, prefix, server: testServer }
}

/**
 * Get the TestFakeServer from a client (for testing with enhanced server functionality)
 */
export function getTestServer(client: TributaryClient): TestFakeServer | null {
  // Access the server through the client's internal properties
  // This is a workaround since the client doesn't expose the server directly
  const anyClient = client as any
  return anyClient.server as TestFakeServer | null
}

/**
 * Wrap children with both TributaryProvider and SyncStatusProvider for tests.
 * Uses a fast poll interval so the background sync loop completes quickly.
 */
export function WithProviders({ client, children }: { client: TributaryClient, children: React.ReactNode }) {
  return React.createElement(
    SyncStatusProvider,
    { client, pollInterval: 60000 },
    React.createElement(
      TributaryProvider,
      { client },
      children
    )
  )
}
