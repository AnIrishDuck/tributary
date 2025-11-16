import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ImportStreamPage from '../src/pages/ImportStreamPage'
import { TributaryProvider, createTestTributaryClient } from '../src/context/tributaryContext'
import { MemoryRouter } from 'react-router'
import * as nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'

// Define a mock navigate function
const mockNavigate = vi.fn()

// Mock the react-router hook
vi.mock('react-router', async () => {
  const actual = await vi.importActual('react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    MemoryRouter: actual.MemoryRouter
  }
})

// Mock the importStream function
const mockImportStream = vi.fn()
vi.mock('../src/actions/importStream', () => ({
  importStream: mockImportStream
}))

describe('ImportStreamPage', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('renders the import stream page with form', () => {
    const { client } = createTestTributaryClient()
    
    render(
      <MemoryRouter>
        <TributaryProvider client={client}>
          <ImportStreamPage />
        </TributaryProvider>
      </MemoryRouter>
    )

    // Check that the page title is rendered
    expect(screen.getByText('Import Existing Stream')).toBeInTheDocument()
    
    // Check that the form elements are present
    expect(screen.getByLabelText(/private key/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import stream/i })).toBeInTheDocument()
    expect(screen.getByText(/or create a new stream/i)).toBeInTheDocument()
  })

  it('shows validation error when form is submitted with empty private key', () => {
    const { client } = createTestTributaryClient()
    
    render(
      <MemoryRouter>
        <TributaryProvider client={client}>
          <ImportStreamPage />
        </TributaryProvider>
      </MemoryRouter>
    )

    // Submit the form without entering a private key
    fireEvent.click(screen.getByRole('button', { name: /import stream/i }))
    
    // Check for validation error
    expect(screen.getByText(/private key is required/i)).toBeInTheDocument()
  })

  it('handles errors when client is null', () => {
    render(
      <MemoryRouter>
        <TributaryProvider client={null}>
          <ImportStreamPage />
        </TributaryProvider>
      </MemoryRouter>
    )

    // Enter a key and submit the form
    fireEvent.change(screen.getByLabelText(/private key/i), { 
      target: { value: 'some-key' } 
    })
    
    fireEvent.click(screen.getByRole('button', { name: /import stream/i }))
    
    // Check for client error
    expect(screen.getByText(/tributary client is not initialized/i)).toBeInTheDocument()
  })

  it.skip('calls importStream and navigates when form is submitted with valid key', async () => {
    const { client } = createTestTributaryClient()
    
    // Mock the importStream function to return a successful result
    const mockPrefix = 'pk/testprefix'
    mockImportStream.mockResolvedValue({ prefix: mockPrefix })

    render(
      <MemoryRouter>
        <TributaryProvider client={client}>
          <ImportStreamPage />
        </TributaryProvider>
      </MemoryRouter>
    )

    // Generate a dummy key
    const keyPair = nacl.sign.keyPair()
    const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey))
    
    // Enter the key and submit the form
    const input = screen.getByLabelText(/private key/i)
    fireEvent.change(input, {
      target: { value: privateKeyBase64 }
    })
    
    const button = screen.getByRole('button', { name: /import stream/i })
    await act(async () => {
      fireEvent.click(button)
    })
    
    // Check that importStream was called with the correct arguments
    expect(mockImportStream).toHaveBeenCalledWith(
      client,
      privateKeyBase64
    )
    
    // Verify navigation
    expect(mockNavigate).toHaveBeenCalledWith(`#${mockPrefix}/`)
  })
})
