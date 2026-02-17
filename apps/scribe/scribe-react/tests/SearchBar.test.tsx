import React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SearchBar } from '../src/components/SearchBar'

describe('SearchBar', () => {
  it('should render search input', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    
    expect(screen.getByPlaceholderText(/Search documents/i)).toBeInTheDocument()
  })

  it('should call onSearch with debounced value', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    
    const input = screen.getByPlaceholderText(/Search documents/i)
    fireEvent.change(input, { target: { value: 'test query' } })
    
    // Should not call immediately
    expect(onSearch).not.toHaveBeenCalled()
    
    // Should call after debounce (300ms)
    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith('test query')
    }, { timeout: 500 })
  })

  it('should show clear button when text present', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} initialValue="test" />)
    
    const clearButton = screen.getByLabelText(/Clear search/i)
    expect(clearButton).toBeInTheDocument()
  })

  it('should clear input when clear button clicked', async () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} initialValue="test" />)
    
    const clearButton = screen.getByLabelText(/Clear search/i)
    fireEvent.click(clearButton)
    
    const input = screen.getByPlaceholderText(/Search documents/i) as HTMLInputElement
    expect(input.value).toBe('')
    
    // Should call onSearch with empty string after debounce
    await waitFor(() => {
      expect(onSearch).toHaveBeenCalledWith('')
    }, { timeout: 500 })
  })

  it('should show loading spinner when loading', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} loading={true} />)
    
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('should use custom placeholder when provided', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} placeholder="Custom placeholder" />)
    
    expect(screen.getByPlaceholderText('Custom placeholder')).toBeInTheDocument()
  })

  it('should autofocus when autoFocus is true', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} autoFocus={true} />)
    
    const input = screen.getByPlaceholderText(/Search documents/i)
    expect(document.activeElement).toBe(input)
  })

  it('should not show clear button when input is empty', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    
    const clearButton = screen.queryByLabelText(/Clear search/i)
    expect(clearButton).not.toBeInTheDocument()
  })

  it('should not show loading spinner when not loading', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} loading={false} />)
    
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).not.toBeInTheDocument()
  })

  it('should update input value when typing', () => {
    const onSearch = vi.fn()
    render(<SearchBar onSearch={onSearch} />)
    
    const input = screen.getByPlaceholderText(/Search documents/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'new value' } })
    
    expect(input.value).toBe('new value')
  })
})
