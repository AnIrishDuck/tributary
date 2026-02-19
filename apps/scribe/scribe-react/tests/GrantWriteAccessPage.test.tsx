import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import GrantWriteAccessPage from '../src/pages/GrantWriteAccessPage'
import { TributaryProvider, createTestTributaryClient } from '../src/context/tributaryContext'
import { createBlock } from 'scribe-data/src/block'
import { up } from 'scribe-data'
import * as nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { MemoryRouter, Routes, Route } from 'react-router'
import { PGlite } from '@electric-sql/pglite'
import { TributaryClient } from 'tributary-client'

// Define a mock navigate function
const mockNavigate = vi.fn()

// Mock react-router at the top level so vi.mock hoisting works correctly
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    MemoryRouter: actual.MemoryRouter,
    Routes: actual.Routes,
    Route: actual.Route
  }
})

describe('GrantWriteAccessPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Test directly goes to error state because client is null in mock
  it('shows error when client is null', () => {
    render(
      <MemoryRouter>
        <TributaryProvider client={null}>
          <GrantWriteAccessPage />
        </TributaryProvider>
      </MemoryRouter>
    )

    // Should show error for missing client
    expect(screen.getByText('Missing required parameters')).toBeInTheDocument()
  })

  // Full end-to-end test for the grant/write access route
  it('imports a stream via URL parameters and allows access to its blocks', async () => {
    // STEP 1: Set up a source stream with some blocks
    const { server } = createTestTributaryClient()

    // Create a source client with its own database
    const pglite1 = new PGlite('memory://')
    const sourceClient = new TributaryClient({ server, db: pglite1 })

    // Generate a key pair for the test stream
    const keyPair = nacl.sign.keyPair()
    const privateKey = keyPair.secretKey
    const privateKeyBase64 = base64url.encode(Buffer.from(privateKey))
    const publicKey = keyPair.publicKey
    const publicKeyBase64 = base64url.encode(Buffer.from(publicKey))

    // Create a stream with this key
    const sourceStream = await sourceClient.addWriteKey('scribe', privateKey)
    const sourceLocalDb = sourceStream.local()

    // Run migrations and add some test blocks
    await up(sourceStream, sourceLocalDb)

    const testBlockTitle = 'Test Document from Source Stream'
    await createBlock(sourceStream, {
      block_type: 'scribe/markdown',
      body: `# ${testBlockTitle}\n\nThis is a test document created in the source stream.`,
      inserter: 'test-user-source'
    })

    // Sync to ensure the blocks are persisted in the server
    await sourceStream.sync(1000)

    // Verify the block exists in the source stream
    const sourceBlocks = await sourceLocalDb.query('SELECT * FROM block')
    expect(sourceBlocks.rows.length).toBe(1)

    // STEP 2: Create a new client with a different database (representing a new user)
    const pglite2 = new PGlite('memory://')
    const targetClient = new TributaryClient({ server, db: pglite2 })

    // Verify the new client doesn't have the stream yet
    const initialStreams = await targetClient.list()
    expect(initialStreams.length).toBe(0)

    // STEP 3: Render the GrantWriteAccessPage with the URL parameters
    render(
      <MemoryRouter initialEntries={[`/pk/${publicKeyBase64}/grant/write/${privateKeyBase64}`]}>
        <TributaryProvider client={targetClient}>
          <Routes>
            <Route path="/pk/:prefix/grant/write/:encodedPrivateKey" element={<GrantWriteAccessPage />} />
          </Routes>
        </TributaryProvider>
      </MemoryRouter>
    )

    // Should initially show the Grant Write Access heading
    expect(screen.getByText('Grant Write Access')).toBeInTheDocument()

    // Wait for success state to appear
    await waitFor(() => {
      expect(screen.queryByText('Access Granted!')).toBeInTheDocument()
    })

    // Fast-forward through the redirect timer
    act(() => {
      vi.advanceTimersByTime(2000)
    })

    // STEP 4: Directly verify the stream was imported
    await waitFor(async () => {
      const finalStreams = await targetClient.list()
      expect(finalStreams.length).toBe(1)
      expect(finalStreams[0]).toBe(publicKeyBase64)
    })

    // Get the imported stream and verify it has the block
    const importedStream = await targetClient.get('scribe', publicKeyBase64)
    expect(importedStream).toBeDefined()

    if (importedStream) {
      // Manually sync to pull in the rest of the data
      await importedStream.sync(1000)

      const importedLocalDb = importedStream.local()
      const importedBlocks = await importedLocalDb.query('SELECT * FROM block')

      expect(importedBlocks.rows.length).toBe(1)
      expect(importedBlocks.rows[0].body).toContain(testBlockTitle)
    }
  }, 10000)
})
