import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import EditorPage from '../src/pages/EditorPage'

describe('EditorPage', () => {
  it('should render the editor page with document title', () => {
    render(
      <MemoryRouter>
        <EditorPage />
      </MemoryRouter>
    )
    
    expect(screen.getByText('Edit Document')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('should render the editor page for new document', () => {
    render(
      <MemoryRouter>
        <EditorPage isNew={true} />
      </MemoryRouter>
    )
    
    expect(screen.getByText('New Document')).toBeInTheDocument()
    const textarea = screen.getByRole('textbox')
    expect(textarea).toHaveValue('# New Document\n\nStart writing here...')
  })

  it('should update content when text is entered', () => {
    render(
      <MemoryRouter>
        <EditorPage />
      </MemoryRouter>
    )
    
    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: '# My Test Document\n\nThis is a test.' } })
    
    expect(textarea).toHaveValue('# My Test Document\n\nThis is a test.')
  })

  it('should call save function when Save is clicked', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    
    render(
      <MemoryRouter>
        <EditorPage />
      </MemoryRouter>
    )
    
    const saveButton = screen.getByRole('button', { name: 'Save' })
    fireEvent.click(saveButton)
    
    expect(consoleSpy).toHaveBeenCalledWith('Saving document:', '')
    
    consoleSpy.mockRestore()
  })
})
