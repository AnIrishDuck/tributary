import { describe, it, expect } from 'vitest'
import { createNote } from '../src/note.js'
import { getAllNotes } from '../src/note.js'
import { createHomeLibrary, createLibrary, importLibrary } from '../src/library.js'
import { PGlite } from '@electric-sql/pglite'
import { TributaryClient, FakeServer } from 'tributary-client'
import * as base64url from 'urlsafe-base64'
import nacl from 'tweetnacl'

/**
 * This test mocks the 'normal' scenario - a user creates a new library with notes,
 * then a different user with a different database imports the private key and
 * should be able to view all notes.
 *
 * This tests the key import functionality and sync mechanism.
 */
describe('Key Import Feature', () => {
  it('should allow a new user to import a key and list notes previously added to that library', async () => {
    // STEP 1: First user creates a library with notes
    const server = new FakeServer()

    // Create source client and database
    const sourceDB = new PGlite('memory://sourcedb')
    const sourceClient = new TributaryClient({ server, db: sourceDB })

    // Create a home library first, then create a regular library
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(sourceClient, 'Home', homeKeyPair)
    const { stream: sourceStream, streamId, privateKeyBase64 } = await createLibrary(sourceClient, 'Test Library', homeStream)

    const publicKeyBase64 = streamId

    // Create test notes in source database
    await createNote(sourceStream, {
      block_type: 'scribe/markdown',
      body: '# First Test Document\n\nThis is the first test document.',
      inserter: 'source-user'
    })

    await createNote(sourceStream, {
      block_type: 'scribe/markdown',
      body: '# Second Test Document\n\nThis is the second test document.',
      inserter: 'source-user'
    })

    // Sync to server to make the notes available remotely
    await sourceStream.sync(1000)

    // Verify notes were created in source database
    const sourceNotes = await getAllNotes(sourceStream)
    expect(sourceNotes.length).toBe(2)

    // Verify server has blobs for this stream
    const sourceStreamBlobsResult = await server.getAllBlobMetadata(publicKeyBase64)
    expect(sourceStreamBlobsResult.blobs.length).toBeGreaterThan(0)

    // STEP 2: Second user imports the key and should see the same notes
    const targetDB = new PGlite('memory://targetdb')
    const targetClient = new TributaryClient({ server, db: targetDB })

    // Import the library using the write key
    const { stream: importedStream } = await importLibrary(targetClient, privateKeyBase64)

    // Force one more sync
    await importedStream.sync(1000)

    // Query for notes in the imported library
    const importedNotes = await getAllNotes(importedStream)

    // The imported database should have the same notes
    expect(importedNotes.length).toBe(sourceNotes.length)

    if (importedNotes.length > 0) {
      expect(importedNotes[0].body).toContain('First Test Document')
      expect(importedNotes[1].body).toContain('Second Test Document')
    }
  })
})
