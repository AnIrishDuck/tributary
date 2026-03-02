import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import ImportLibraryPage from '../src/pages/ImportLibraryPage'
import { TributaryProvider, createTestTributaryClient } from 'scribe-react-common/src/context/tributaryContext'
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

// Mock the importLibrary function
const mockImportLibrary = vi.fn()
vi.mock('../src/actions/importLibrary', () => ({
  importLibrary: mockImportLibrary
}))

describe('ImportLibraryPage', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('renders the import library page with form', () => {
    const { client } = createTestTributaryClient()
    
    render(
      <MemoryRouter>
        <TributaryProvider client={client}>
          <ImportLibraryPage />
        </TributaryProvider>
      </MemoryRouter>
    )

    // Check that the page title is rendered
    expect(screen.getByText('Import Existing Library')).toBeInTheDocument()
    
    // Check that the form elements are present
    expect(screen.getByLabelText(/private key/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import library/i })).toBeInTheDocument()
    expect(screen.getByText(/or create a new library/i)).toBeInTheDocument()
  })

  it('shows validation error when form is submitted with empty private key', () => {
    const { client } = createTestTributaryClient()
    
    render(
      <MemoryRouter>
        <TributaryProvider client={client}>
          <ImportLibraryPage />
        </TributaryProvider>
      </MemoryRouter>
    )

    // Submit the form without entering a private key
    fireEvent.click(screen.getByRole('button', { name: /import library/i }))
    
    // Check for validation error
    expect(screen.getByText(/private key is required/i)).toBeInTheDocument()
  })

  it('handles errors when client is null', () => {
    render(
      <MemoryRouter>
        <TributaryProvider client={null}>
          <ImportLibraryPage />
        </TributaryProvider>
      </MemoryRouter>
    )

    // Enter a key and submit the form
    fireEvent.change(screen.getByLabelText(/private key/i), { 
      target: { value: 'some-key' } 
    })
    
    fireEvent.click(screen.getByRole('button', { name: /import library/i }))
    
    // Check for client error
    expect(screen.getByText(/tributary client is not initialized/i)).toBeInTheDocument()
  })

  it.skip('calls importLibrary and navigates when form is submitted with valid key', async () => {
    const { client } = createTestTributaryClient()
    
    // Mock the importLibrary function to return a successful result
    const mockPrefix = 'pk/testprefix'
    mockImportLibrary.mockResolvedValue({ prefix: mockPrefix })

    render(
      <MemoryRouter>
        <TributaryProvider client={client}>
          <ImportLibraryPage />
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
    
    const button = screen.getByRole('button', { name: /import library/i })
    await act(async () => {
      fireEvent.click(button)
    })
    
    // Check that importLibrary was called with the correct arguments
    expect(mockImportLibrary).toHaveBeenCalledWith(
      client,
      privateKeyBase64
    )
    
    // Verify navigation
    expect(mockNavigate).toHaveBeenCalledWith(`#${mockPrefix}/`)
  })
})
