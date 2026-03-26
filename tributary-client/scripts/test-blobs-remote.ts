/**
 * Manual test script for the tributary blobs API against a remote Supabase instance.
 *
 * Uses the tributary-client library (TributaryBlob + TributaryServer) to exercise
 * the full upload/download flow: chunking, encryption, merkle proofs, and verification.
 *
 * Usage:
 *   SUPABASE_URL=https://<project>.supabase.co SUPABASE_JWT=<token> npx tsx scripts/test-blobs-remote.ts
 */

import nacl from 'tweetnacl'
import { TributaryServer } from '../src/tributaryServer.js'
import { TributaryBlob } from '../src/tributaryBlob.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_JWT = process.env.SUPABASE_JWT

if (!SUPABASE_URL || !SUPABASE_JWT) {
  console.error('Missing required env vars: SUPABASE_URL, SUPABASE_JWT')
  process.exit(1)
}

const functionsUrl = `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1`

const server = new TributaryServer(functionsUrl, SUPABASE_JWT)
server.setBlobBaseUrl(functionsUrl)

const readKey = nacl.randomBytes(64)
const blob = new TributaryBlob(server, readKey)

const testData = new TextEncoder().encode(
  `Hello tributary blobs! Test at ${new Date().toISOString()}`
)

async function run() {
  console.log('--- Tributary Blobs API Manual Test ---')
  console.log(`Target: ${functionsUrl}`)
  console.log(`Test payload: ${testData.length} bytes`)
  console.log()

  // Upload
  console.log('1. Uploading blob...')
  const rootHash = await blob.upload(testData, 'https://manual-test.local')
  console.log(`   Root hash: ${rootHash}`)
  console.log()

  // Metadata
  console.log('2. Fetching metadata...')
  const metadata = await blob.getMetadata(rootHash)
  if (!metadata) {
    throw new Error('Metadata returned null after upload')
  }
  console.log(`   rootHash:   ${metadata.rootHash}`)
  console.log(`   domain:     ${metadata.domain}`)
  console.log(`   size:       ${metadata.size} bytes (encrypted)`)
  console.log(`   chunkCount: ${metadata.chunkCount}`)
  console.log(`   createdAt:  ${metadata.createdAt}`)
  console.log()

  // Download + verify
  console.log('3. Downloading and decrypting...')
  const downloaded = await blob.download(rootHash)
  const match = downloaded.length === testData.length &&
    downloaded.every((b, i) => b === testData[i])

  if (!match) {
    throw new Error(
      `Round-trip mismatch! Uploaded ${testData.length} bytes, got back ${downloaded.length} bytes`
    )
  }

  const decoded = new TextDecoder().decode(downloaded)
  console.log(`   Decrypted:  "${decoded}"`)
  console.log()

  console.log('All tests passed.')
}

run().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
