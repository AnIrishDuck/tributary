import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { routes } from '../src/route'
import { TributaryClient } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { TestFakeServer } from 'scribe-react-common/tests/test-server'
import { createTestTributaryClient } from 'scribe-react-common/src/context/tributaryContext'
import { createTestClientWithStream, WithProviders, WithFastSyncProviders, createFreshLoginClient } from './test-utils'
import { saveNote } from 'scribe-react-note/src/actions/saveNote'
import { createHomeLibrary, createLibrary } from 'scribe-data'
import * as scribeData from 'scribe-data'

describe('SlugViewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render error state when parameters are missing', async () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ['/pk/test-prefix/test-slug']
    })

    const { client } = createTestTributaryClient()

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show error state for missing parameters
    await waitFor(() => {
      expect(screen.getByText(/Failed to load note/)).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('should show disambiguation page when slug matches both a note and a collection', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    const localDb = stream.local()
    const library = await scribeData.getLibrary(localDb)
    expect(library).toBeDefined()

    // Create a collection with slug "recipes"
    const col = await scribeData.createCollection(stream, {
      title: 'Recipes',
      parent_collection_uuid: library!.collection_uuid,
      inserter: 'test-user'
    })
    await stream.sync(1000)
    await scribeData.indexAll(stream.local())

    // Create a note with the same slug "recipes"
    await saveNote(stream, '# Recipes\n\nA note about recipes.')

    // Navigate to the shared slug
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/recipes`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // When a note and collection share a slug, the disambiguation page should appear
    await waitFor(() => {
      expect(screen.getByText(/Multiple items match/)).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should render a specific historical version via @versionUuid suffix', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Create a note with initial content
    const { block } = await saveNote(stream, '# Pasta\n\nOriginal recipe.')
    const firstVersionUuid = block.version_uuid

    // Create a second version with updated content
    await saveNote(stream, '# Pasta\n\nUpdated recipe.', 'web-ui', block.block_uuid)

    // Navigate to the first version using @versionUuid suffix
    const slug = block.slug
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}@${firstVersionUuid}`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show the original version content
    await waitFor(() => {
      expect(screen.getByText(/Original recipe/)).toBeInTheDocument()
    }, { timeout: 5000 })

    // Should show the historical version badge
    expect(screen.getByText('Viewing historical version')).toBeInTheDocument()

    // Should NOT show the Edit FAB (read-only mode)
    expect(screen.queryByLabelText('Edit')).toBeNull()
  })

  it('should render history page when navigating to slug&history', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Create a note with two versions
    const { block } = await saveNote(stream, '# Pasta\n\nVersion 1.')
    await saveNote(stream, '# Pasta\n\nVersion 2.', 'web-ui', block.block_uuid)

    const slug = block.slug
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}&history`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show the history page header
    await waitFor(() => {
      expect(screen.getByText('Version History')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Should show version entries with "current" badge for authoritative version
    await waitFor(() => {
      expect(screen.getByText('current')).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should show error for invalid version UUID in @suffix', async () => {
    const { client, stream, prefix } = await createTestClientWithStream()
    const base64Part = prefix.split('/')[1]

    // Create a note
    const { block } = await saveNote(stream, '# Pasta\n\nA recipe.')
    const slug = block.slug

    // Navigate with a non-existent version UUID
    const fakeVersionUuid = '00000000-0000-0000-0000-000000000000'
    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${base64Part}/${slug}@${fakeVersionUuid}`]
    })

    render(
      <WithProviders client={client}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show an error
    await waitFor(() => {
      expect(screen.getByText(/Version not found|Failed to load note/)).toBeInTheDocument()
    }, { timeout: 5000 })
  })

  it('should load a note via direct link on fresh login (sync discovers linked library)', async () => {
    const { clientA, clientB, linkedStream, linkedStreamId } = await createFreshLoginClient('Shared Notes')

    // Create a note in the linked library via Client A
    await saveNote(linkedStream, '# Direct Link Note\n\nThis note was reached via a direct link.')
    await clientA.sync(1000)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${linkedStreamId}/direct-link-note`]
    })

    render(
      <WithFastSyncProviders client={clientB}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    // The sync loop should discover the linked library, register it, sync it,
    // and then SlugViewPage should render the note content.
    await waitFor(() => {
      expect(screen.getByText(/This note was reached via a direct link/)).toBeInTheDocument()
    }, { timeout: 15000 })

    // Should NOT show any error
    expect(screen.queryByText(/Failed to load note/)).toBeNull()
  })

  it('should show loading state when library schema is not yet synced', async () => {
    const server = new TestFakeServer()

    // Client A: create a library with content
    const clientA = new TributaryClient({ server, db: new PGlite('memory://') })
    const homeKeyPairA = nacl.sign.keyPair()
    const { stream: homeStreamA } = await createHomeLibrary(clientA, 'Home A', homeKeyPairA)
    const { stream: linkedStream, streamId: linkedStreamId, privateKeyBase64 } = await createLibrary(clientA, 'Schema Test', homeStreamA)
    await saveNote(linkedStream, '# Test Note\n\nContent.')
    await clientA.sync(1000)

    // Client B: register the linked key WITHOUT syncing — schema not ready
    const clientB = new TributaryClient({ server, db: new PGlite('memory://') })
    const homeKeyPairB = nacl.sign.keyPair()
    await createHomeLibrary(clientB, 'Home B', homeKeyPairB)
    const privateKeyBytes = base64url.decode(privateKeyBase64)
    await clientB.addWriteKey('scribe', privateKeyBytes)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${linkedStreamId}/test-note`]
    })

    render(
      <WithProviders client={clientB}>
        <RouterProvider router={router} />
      </WithProviders>
    )

    // Should show loading spinner (not an error) because the library hasn't synced yet
    await waitFor(() => {
      expect(screen.getByText('Loading...')).toBeInTheDocument()
    }, { timeout: 5000 })

    // Should NOT show any schema or load error
    expect(screen.queryByText(/Failed to load note/)).toBeNull()
    expect(screen.queryByText(/schema could not be loaded/)).toBeNull()
  })

  it('should show schema error when library is fully synced but schema is missing', async () => {
    const server = new TestFakeServer()

    // Create a completely empty stream (no syncedMigrations, no content)
    const clientA = new TributaryClient({ server, db: new PGlite('memory://') })
    const emptyKeyPair = nacl.sign.keyPair()
    // Just register the key, DON'T run syncedMigrations
    await clientA.addWriteKey('scribe', emptyKeyPair.secretKey)

    // Client B: register the same key and let sync loop run
    const clientB = new TributaryClient({ server, db: new PGlite('memory://') })
    const homeKeyPairB = nacl.sign.keyPair()
    await createHomeLibrary(clientB, 'Home B', homeKeyPairB)
    await clientB.addWriteKey('scribe', emptyKeyPair.secretKey)

    const streamId = base64url.encode(Buffer.from(emptyKeyPair.publicKey))

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${streamId}/some-note`]
    })

    render(
      <WithFastSyncProviders client={clientB}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    // The sync loop will sync the empty stream (completes immediately since no blobs),
    // marking it as synced. But schema tables don't exist → should show schema error.
    await waitFor(() => {
      expect(screen.getByText(/schema could not be loaded/)).toBeInTheDocument()
    }, { timeout: 15000 })
  })

  it('should transition from schema loading to content once sync completes', async () => {
    const { clientA, clientB, linkedStream, linkedStreamId } = await createFreshLoginClient('Sync Library')

    // Create a note in the linked library
    await saveNote(linkedStream, '# Synced Note\n\nThis appears after schema syncs.')
    await clientA.sync(1000)

    const router = createMemoryRouter(routes, {
      initialEntries: [`/pk/${linkedStreamId}/synced-note`]
    })

    render(
      <WithFastSyncProviders client={clientB}>
        <RouterProvider router={router} />
      </WithFastSyncProviders>
    )

    // Initially should be in a loading state (either generic or schema loading)
    await waitFor(() => {
      const loading = screen.queryByText('Loading...')
      const syncing = screen.queryByText('Syncing library...')
      expect(loading || syncing).toBeTruthy()
    }, { timeout: 3000 })

    // After sync completes, should show the note content
    await waitFor(() => {
      expect(screen.getByText(/This appears after schema syncs/)).toBeInTheDocument()
    }, { timeout: 15000 })

    // Should NOT show any error
    expect(screen.queryByText(/Failed to load note/)).toBeNull()
    expect(screen.queryByText(/schema could not be loaded/)).toBeNull()
  })
})
