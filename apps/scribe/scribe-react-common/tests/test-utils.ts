import React from 'react'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { PGlite } from '@electric-sql/pglite'
import { TributaryClient, TributaryStream, Server, TestFakeServer } from 'tributary-client'
import { createHomeLibrary, createLibrary } from 'scribe-data'
import { createTestTributaryClient } from '../src/context/tributaryContext'
import { TributaryProvider } from '../src/context/tributaryContext'
import { SyncStatusProvider } from '../src/context/syncStatusContext'

/**
 * Create a test client with a stream for testing
 * Returns the client, stream, and routing prefix
 * Backwards compatible: destructure only what you need
 */
export async function createTestClientWithStream(name: string = 'Test Stream'): Promise<{
  client: TributaryClient,
  stream: TributaryStream,
  streamId: string,
  prefix: string,
  server?: Server
}> {
  // Create test client (this uses createTestServer internally)
  const { client, server } = createTestTributaryClient()

  // Create a home library first (required by createLibrary)
  const homeKeyPair = nacl.sign.keyPair()
  const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)

  const { stream, prefix, streamId } = await createLibrary(client, name, homeStream)

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

/**
 * Like WithProviders, but with a fast poll interval so the sync loop
 * actually runs during tests. Use for tests that need the sync loop to
 * discover and register linked libraries.
 */
export function WithFastSyncProviders({ client, children }: { client: TributaryClient, children: React.ReactNode }) {
  return React.createElement(
    SyncStatusProvider,
    { client, pollInterval: 100 },
    React.createElement(
      TributaryProvider,
      { client },
      children
    )
  )
}

/**
 * Simulate the "fresh login direct-link" scenario:
 * 1. Client A creates a home library + linked library, syncs everything to the server
 * 2. Client B (fresh PGlite) registers only the home key pair and syncs the home stream
 *    (simulating what registerHomeKey() does on login)
 * 3. Returns Client B and the linked library's streamId so you can render a page
 *    that navigates directly to the linked library — the sync loop must discover it.
 */
export async function createFreshLoginClient(libraryName: string = 'Shared Library'): Promise<{
  clientA: TributaryClient,
  clientB: TributaryClient,
  linkedStream: TributaryStream,
  linkedStreamId: string,
  homeStreamId: string,
  server: TestFakeServer
}> {
  const server = new TestFakeServer()

  // Client A: set up home + linked library
  const clientA = new TributaryClient({ server, db: new PGlite('memory://') })
  const homeKeyPair = nacl.sign.keyPair()
  const { stream: homeStreamA, streamId: homeStreamId } = await createHomeLibrary(clientA, 'Home', homeKeyPair)
  const { stream: linkedStream, streamId: linkedStreamId } = await createLibrary(clientA, libraryName, homeStreamA)
  await clientA.sync(1000)

  // Client B: fresh login — only the home key pair is known
  const clientB = new TributaryClient({ server, db: new PGlite('memory://') })
  const publicKeyBase64 = base64url.encode(Buffer.from(homeKeyPair.publicKey))
  await clientB.addWriteKey('scribe', homeKeyPair.secretKey)
  await clientB.setHomeStream(publicKeyBase64)

  // Sync the home stream (simulates registerHomeKey's sync step)
  const homeStreamB = await clientB.get('scribe', publicKeyBase64)
  if (homeStreamB) {
    await homeStreamB.sync(1000)
  }

  return { clientA, clientB, linkedStream, linkedStreamId, homeStreamId, server }
}
