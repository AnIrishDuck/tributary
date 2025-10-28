import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import NewStreamPage from '../src/pages/NewStreamPage'
import { TributaryProvider, createTestTributaryClient } from '../src/context/tributaryContext'
import nacl from 'tweetnacl'

// Mock the useNavigate hook from react-router-dom
const mockNavigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate
  }
})

describe('NewStreamPage', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    vi.clearAllMocks()
  })

  it('should render the new stream form', () => {
    const { client } = createTestTributaryClient()
    
    render(
      <TributaryProvider client={client}>
        <MemoryRouter>
          <NewStreamPage />
        </MemoryRouter>
      </TributaryProvider>
    )
    
    expect(screen.getByText('Create New Scribe Stream')).toBeInTheDocument()
    expect(screen.getByText(/end-to-end encryption/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create New Stream' })).toBeInTheDocument()
  })

  it('should show loading state when button is clicked', async () => {
    const { client } = createTestTributaryClient()
    
    render(
      <TributaryProvider client={client}>
        <MemoryRouter>
          <NewStreamPage />
        </MemoryRouter>
      </TributaryProvider>
    )
    
    const button = screen.getByRole('button', { name: 'Create New Stream' })
    fireEvent.click(button)
    
    // Check that loading state is displayed immediately
    expect(screen.getByText('Creating Stream...')).toBeInTheDocument()
    // Button should be disabled during loading
    expect(button).toBeDisabled()
  })

  it('should create a new stream and navigate to it using TributaryClient', async () => {
    const { client } = createTestTributaryClient()
    
    const mockNavigate = vi.fn()
    render(
      <TributaryProvider client={client}>
        <MemoryRouter>
          <NewStreamPage navigate={mockNavigate} />
        </MemoryRouter>
      </TributaryProvider>
    )
    
    const button = screen.getByRole('button', { name: 'Create New Stream' })
    fireEvent.click(button)
    
    // Wait for loading state to appear
    await waitFor(() => {
      expect(screen.getByText('Creating Stream...')).toBeInTheDocument()
    }, { timeout: 1000 })
    
    // Button should be disabled during loading
    expect(button).toBeDisabled()
    
    // Wait for navigation to occur (async operation)
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled()
    }, { timeout: 2000 })
    
    // Verify navigation was called with correct path pattern
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringMatching(/^\/pk\/[A-Za-z0-9_-]+\/$/))
  })

  it('should handle stream creation errors gracefully', async () => {
    // This test needs to be adjusted since we're using a real test client now
    // which should actually work. Let's skip this test for now or adjust it
    // to test a different error condition.
    
    // For now we'll test with a client that has its addWriteKey method mocked to fail
    const { client } = createTestTributaryClient()
    
    // Mock the addWriteKey method to throw an error
    if (client) {
      vi.spyOn(client, 'addWriteKey').mockRejectedValue(new Error('Stream creation failed'))
    }
    
    render(
      <TributaryProvider client={client}>
        <MemoryRouter>
          <NewStreamPage />
        </MemoryRouter>
      </TributaryProvider>
    )
    
    const button = screen.getByRole('button', { name: 'Create New Stream' })
    fireEvent.click(button)
    
    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText('Failed to create new stream. Please try again.')).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('should handle missing Tributary client gracefully', async () => {
    render(
      <TributaryProvider client={null}>
        <MemoryRouter>
          <NewStreamPage />
        </MemoryRouter>
      </TributaryProvider>
    )
    
    const button = screen.getByRole('button', { name: 'Create New Stream' })
    fireEvent.click(button)
    
    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByText('Tributary client not available')).toBeInTheDocument()
    }, { timeout: 2000 })
  })
})
