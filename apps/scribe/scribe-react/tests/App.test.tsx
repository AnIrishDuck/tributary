import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../src/App'

describe('App', () => {
  it('should render the app with routing', () => {
    render(<App />)
    
    // Should render the NewStreamPage by default
    expect(screen.getByText('Create New Scribe Stream')).toBeInTheDocument()
  })
})
