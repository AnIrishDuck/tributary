import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HomePage from '../src/pages/HomePage'

describe('HomePage', () => {
  it('should render the welcome message', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )
    
    expect(screen.getByText('Scribe Documents')).toBeInTheDocument()
    expect(screen.getByText('Welcome to Scribe, your end-to-end encrypted document editor.')).toBeInTheDocument()
  })

  it('should render the create and import buttons', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    )
    
    expect(screen.getByRole('button', { name: 'Create New Document' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Stream' })).toBeInTheDocument()
  })
})
