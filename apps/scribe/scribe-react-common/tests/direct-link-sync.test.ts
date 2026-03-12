import { describe, it, expect } from 'vitest'
import { TributaryClient } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { TestFakeServer } from './test-server'
import { createHomeLibrary, createLibrary, seedLinkedLibrariesCache } from 'scribe-data/src/library'
import { getLinkedLibraries } from 'scribe-data/src/collection'
import { createNote } from 'scribe-data/src/note'
import { indexAll } from 'scribe-data/src/indexing'
import { localMigrations } from 'scribe-data/src/migrations'

/**
 * These tests verify the fix for direct-link navigation on fresh login.
 *
 * The scenario: User A shares a link to a note in a linked library.
 * User B (or User A after logout) opens the link, logs in, and the app
 * must discover and sync the linked library before the note can be displayed.
 *
 * Previously, linked libraries were only registered when the home page
 * loaded. If the user navigated directly to a linked library URL, the
 * library was never registered and client.get() returned undefined.
 *
 * The fix adds linked library registration to the sync loop: after the
 * home stream syncs, getLinkedLibraries() discovers linked streams and
 * addWriteKey() registers them so subsequent sync ticks can process them.
 */
describe('Direct link sync on fresh login', () => {
  it('fresh client can discover linked libraries after syncing home stream', async () => {
    const server = new TestFakeServer()

    // --- Client A: set up home + linked library with a note ---
    const clientA = new TributaryClient({ server, db: new PGlite('memory://') })
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStreamA, streamId: homeStreamId } = await createHomeLibrary(clientA, 'Home', homeKeyPair)
    const { stream: linkedStreamA, streamId: linkedStreamId } = await createLibrary(clientA, 'Shared Notes', homeStreamA)

    // Create a note in the linked library
    await createNote(linkedStreamA, {
      block_type: 'scribe/markdown',
      body: '# Direct Link Test\n\nThis note should be reachable via direct link.',
      inserter: 'user-a',
    })

    // Sync everything to server
    await clientA.sync(1000)

    // --- Client B: fresh login, only knows the home key pair ---
    const clientB = new TributaryClient({ server, db: new PGlite('memory://') })

    // Simulate registerHomeKey(): register the home stream via keypair
    const publicKeyBase64 = base64url.encode(Buffer.from(homeKeyPair.publicKey))
    await clientB.addWriteKey('scribe', homeKeyPair.secretKey)
    await clientB.setHomeStream(publicKeyBase64)

    // Before syncing: Client B should NOT know about the linked library
    const streamsBefore = await clientB.list()
    expect(streamsBefore).toContain(homeStreamId)
    expect(streamsBefore).not.toContain(linkedStreamId)

    // The linked library should NOT be accessible yet
    const linkedBefore = await clientB.get('scribe', linkedStreamId)
    expect(linkedBefore).toBeUndefined()

    // --- Sync the home stream (simulating registerHomeKey's sync step) ---
    const homeStreamB = await clientB.get('scribe', homeStreamId)
    expect(homeStreamB).toBeDefined()
    await homeStreamB!.sync(1000)

    // --- Discovery step (the logic we added to syncStatusContext) ---
    // After home stream syncs, discover linked libraries and register them
    const linkedLibraries = await getLinkedLibraries(homeStreamB!)
    expect(linkedLibraries).toHaveLength(1)
    expect(linkedLibraries[0].title).toBe('Shared Notes')
    expect(linkedLibraries[0].linked_stream_id).toBe(linkedStreamId)
    expect(linkedLibraries[0].linked_stream_key).toBeTruthy()

    // Register linked library via addWriteKey (the fix in syncStatusContext)
    for (const col of linkedLibraries) {
      if (col.linked_stream_key) {
        await clientB.addWriteKey('scribe', col.linked_stream_key)
      }
    }

    // --- Now the linked library should be accessible ---
    const streamsAfter = await clientB.list()
    expect(streamsAfter).toContain(linkedStreamId)

    const linkedStreamB = await clientB.get('scribe', linkedStreamId)
    expect(linkedStreamB).toBeDefined()

    // Sync the linked library
    await linkedStreamB!.sync(1000)

    // Run local migrations + indexing (as the sync loop does)
    await localMigrations(linkedStreamB!.local())
    await indexAll(linkedStreamB!.local())

    // Verify the note is accessible
    const result = await linkedStreamB!.query(
      `SELECT body FROM block WHERE block_type = 'scribe/markdown'`,
      []
    )
    expect(result.rows).toHaveLength(1)
    expect((result.rows[0] as any).body).toContain('Direct Link Test')
  })

  it('seedLinkedLibrariesCache works alongside addWriteKey registration', async () => {
    const server = new TestFakeServer()

    // Client A: set up libraries
    const clientA = new TributaryClient({ server, db: new PGlite('memory://') })
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStreamA } = await createHomeLibrary(clientA, 'Home', homeKeyPair)
    await createLibrary(clientA, 'Lib One', homeStreamA)
    await createLibrary(clientA, 'Lib Two', homeStreamA)
    await clientA.sync(1000)

    // Client B: fresh login
    const clientB = new TributaryClient({ server, db: new PGlite('memory://') })
    const publicKeyBase64 = base64url.encode(Buffer.from(homeKeyPair.publicKey))
    await clientB.addWriteKey('scribe', homeKeyPair.secretKey)
    await clientB.setHomeStream(publicKeyBase64)

    const homeStreamB = await clientB.get('scribe', publicKeyBase64)
    expect(homeStreamB).toBeDefined()
    await homeStreamB!.sync(1000)

    // Run localMigrations on home stream (needed for linked_libraries table)
    await localMigrations(homeStreamB!.local())

    // Replicate the exact sync loop logic: seed cache + register streams
    await seedLinkedLibrariesCache(homeStreamB!, homeStreamB!.local())
    const linkedLibraries = await getLinkedLibraries(homeStreamB!)
    expect(linkedLibraries).toHaveLength(2)

    for (const col of linkedLibraries) {
      if (col.linked_stream_key) {
        await clientB.addWriteKey('scribe', col.linked_stream_key)
      }
    }

    // Both linked libraries should now be registered and syncable
    const streams = await clientB.list()
    expect(streams).toHaveLength(3) // home + 2 linked

    for (const col of linkedLibraries) {
      const stream = await clientB.get('scribe', col.linked_stream_id!)
      expect(stream).toBeDefined()
      await stream!.sync(1000)

      // Verify the linked library root collection exists
      const root = await stream!.query(
        `SELECT title FROM collection WHERE parent_collection_uuid IS NULL`,
        []
      )
      expect(root.rows).toHaveLength(1)
      expect((root.rows[0] as any).title).toMatch(/^Lib (One|Two)$/)
    }
  })
})
