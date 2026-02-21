import { describe, it, expect } from 'vitest'
import { up } from 'scribe-data'
import { createNote } from 'scribe-data'
import { getAllNotes } from 'scribe-data/src/note'
import { PGlite } from '@electric-sql/pglite'
import { TributaryClient, FakeServer, createTestServer } from 'tributary-client'
import * as base64url from 'urlsafe-base64'
import * as nacl from 'tweetnacl'
import { importLibrary } from '../src/actions/importLibrary'

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
    const server = createTestServer() as FakeServer

    // Create source client and database
    const sourceDB = new PGlite('memory://sourcedb')
    const sourceClient = new TributaryClient({ server, db: sourceDB })

    // Generate key pair and create a new stream
    const keyPair = nacl.sign.keyPair()
    const sourceStream = await sourceClient.addWriteKey('scribe', keyPair.secretKey)

    // Run scribe migrations on new stream
    await up(sourceStream, sourceStream.local())
    await sourceStream.sync(1000)

    const publicKeyBase64 = base64url.encode(Buffer.from(keyPair.publicKey))
    const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey))

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
