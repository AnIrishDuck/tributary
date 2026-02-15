import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { createTestDB } from 'scribe-data/tests/test-utils'
import { up } from 'scribe-data'
import { createBlock } from 'scribe-data'
import { getAllBlocks } from 'scribe-data/src/block'
import { PGlite } from '@electric-sql/pglite'
import { TributaryClient } from 'tributary-client'
import { FakeServer } from 'tributary-client/src/fakeServer' 
import { createTestServer } from 'tributary-client'
import * as base64url from 'urlsafe-base64'
import * as nacl from 'tweetnacl'
import { importStream } from '../src/actions/importStream'
import { createStream } from '../src/actions/createStream'

/**
 * This test mocks the 'normal' scenario - a user creates a new stream with blocks,
 * then a different user with a different database imports the private key and
 * should be able to view all blocks.
 * 
 * This tests the key import functionality and sync mechanism.
 */
describe('Key Import Feature', () => {
  // Run test with fresh databases each time to ensure isolation
  it('should allow a new user to import a key and list blocks previously added to that stream', async () => {
    // STEP 1: First user creates a stream with blocks
    console.log('SETUP: Creating source database and stream with blocks...')

    // Create a server that both clients will use
    const server = createTestServer() as FakeServer
    
    // Create source client and database
    const sourceDB = new PGlite('memory://sourcedb')
    const sourceClient = new TributaryClient({ server, db: sourceDB })
    
    // Generate key pair directly instead of using createStream
    // This allows us to have access to the server for blob verification
    const keyPair = nacl.sign.keyPair()
    
    // Add the write key to create a new stream
    const sourceStream = await sourceClient.addWriteKey('scribe', keyPair.secretKey)
    
    // Run scribe migrations on new stream
    await up(sourceStream, sourceStream.local())
    
    // Sync the stream to ensure persistence
    await sourceStream.sync(1000)
    
    // Get the public key
    const publicKeyBase64 = base64url.encode(Buffer.from(keyPair.publicKey))
    const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey))
    
    // Create test blocks in source database
    const block1 = await createBlock(sourceStream, {
      block_type: 'scribe/markdown',
      body: '# First Test Document\n\nThis is the first test document.',
      inserter: 'source-user'
    })
    
    const block2 = await createBlock(sourceStream, {
      block_type: 'scribe/markdown',
      body: '# Second Test Document\n\nThis is the second test document.',
      inserter: 'source-user'
    })
    
    // Sync to server to make the blocks available remotely
    await sourceStream.sync(1000)
    
    // Verify blocks were created in source database
    const sourceBlocks = await getAllBlocks(sourceStream)
    console.log(`Source database has ${sourceBlocks.length} blocks`)
    expect(sourceBlocks.length).toBe(2)
    
    // Verify server has blobs for this stream
    const sourceStreamBlobsResult = await server.getAllBlobMetadata(publicKeyBase64)
    console.log(`Server has ${sourceStreamBlobsResult.blobs.length} blobs for this stream`)
    expect(sourceStreamBlobsResult.blobs.length).toBeGreaterThan(0)
    
    // Log blob details
    for (const blob of sourceStreamBlobsResult.blobs) {
      console.log(`Blob: ${blob.pubkey}:${blob.sequenceNumber} - hash: ${blob.hash.substring(0, 8)}... - ${blob.data?.length || 0} bytes`)
    }
    
    // Also check what all blobs the server has
    const allBlobs = server.getAllBlobs()
    console.log(`Server has ${allBlobs.length} total blobs`)
    for (const blob of allBlobs) {
      console.log(`All blob: ${blob.pubkey}:${blob.sequenceNumber} - hash: ${blob.hash.substring(0, 8)}...`)
    }
    
    // STEP 2: Second user imports the key and should see the same blocks
    console.log('TEST: Creating target database and importing the key...')
    
    // Create completely separate database and client for the target
    const targetDB = new PGlite('memory://targetdb')
    const targetClient = new TributaryClient({ server, db: targetDB })
    
    // Import the stream using the write key
    console.log('About to import stream with private key')
    const { stream: importedStream } = await importStream(targetClient, privateKeyBase64)
    console.log('Stream imported, about to sync')
    
    // Check what the imported stream's lastSyncIndex is
    const importedStreamAny = importedStream as any;
    console.log('Imported stream lastSyncIndex:', importedStreamAny.lastSyncIndex)
    
    // Force one more sync
    await importedStream.sync(1000)
    console.log('Sync completed')
    console.log('Imported stream lastSyncIndex after sync:', importedStreamAny.lastSyncIndex)
    
    // Query for blocks in the imported stream using the relevant function from scribe-data
    const importedBlocks = await getAllBlocks(importedStream)
    console.log(`Imported database has ${importedBlocks.length} blocks`)
    
    // If we still have 0 blocks, let's check what the server returns for this public key
    if (importedBlocks.length === 0) {
      const importedPublicKey = importedStream.getPublicKeyBase64()
      console.log('Imported stream public key:', importedPublicKey)
      
      const importedStreamBlobsResult = await server.getAllBlobMetadata(importedPublicKey)
      console.log(`Server has ${importedStreamBlobsResult.blobs.length} blobs for imported stream`)
      for (const blob of importedStreamBlobsResult.blobs) {
        console.log(`Imported blob: ${blob.pubkey}:${blob.sequenceNumber} - hash: ${blob.hash.substring(0, 8)}...`)
      }
    }
    
    // ASSERTION: The imported database should have the same blocks
    expect(importedBlocks.length).toBe(sourceBlocks.length)
    
    if (importedBlocks.length > 0) {
      // Verify content matches what we expect
      expect(importedBlocks[0].body).toContain('First Test Document')
      expect(importedBlocks[1].body).toContain('Second Test Document')
    }
  })
})
