import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import GrantWriteAccessPage from '../src/pages/GrantWriteAccessPage'
import { TributaryProvider, createTestTributaryClient } from 'scribe-react-common/src/context/tributaryContext'
import { createNote } from 'scribe-data/src/note'
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
  it('imports a library via URL parameters and allows access to its notes', async () => {
    // STEP 1: Set up a source library with some notes
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

    // Run migrations and add some test notes
    await up(sourceStream, sourceLocalDb)

    const testNoteTitle = 'Test Document from Source Stream'
    await createNote(sourceStream, {
      block_type: 'scribe/markdown',
      body: `# ${testNoteTitle}\n\nThis is a test document created in the source library.`,
      inserter: 'test-user-source'
    })

    // Sync to ensure the notes are persisted in the server
    await sourceStream.sync(1000)

    // Verify the note exists in the source library
    const sourceNotes = await sourceLocalDb.query('SELECT * FROM block')
    expect(sourceNotes.rows.length).toBe(1)

    // STEP 2: Create a new client with a different database (representing a new user)
    const pglite2 = new PGlite('memory://')
    const targetClient = new TributaryClient({ server, db: pglite2 })

    // Verify the new client doesn't have the library yet
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

    // STEP 4: Directly verify the library was imported
    await waitFor(async () => {
      const finalStreams = await targetClient.list()
      expect(finalStreams.length).toBe(1)
      expect(finalStreams[0]).toBe(publicKeyBase64)
    })

    // Get the imported library and verify it has the note
    const importedStream = await targetClient.get('scribe', publicKeyBase64)
    expect(importedStream).toBeDefined()

    if (importedStream) {
      // Manually sync to pull in the rest of the data
      await importedStream.sync(1000)

      const importedLocalDb = importedStream.local()
      const importedNotes = await importedLocalDb.query('SELECT * FROM block')

      expect(importedNotes.rows.length).toBe(1)
      expect(importedNotes.rows[0].body).toContain(testNoteTitle)
    }
  }, 10000)
})
