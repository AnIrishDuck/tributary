import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConflictWarning from '../src/components/ConflictWarning'

describe('ConflictWarning', () => {
  it('should render the warning message and both buttons', () => {
    render(<ConflictWarning onReload={vi.fn()} onDismiss={vi.fn()} />)

    expect(
      screen.getByText('This note has been updated elsewhere. You may want to save your work and reload.')
    ).toBeInTheDocument()
    expect(screen.getByText('Reload')).toBeInTheDocument()
    expect(screen.getByText('Dismiss')).toBeInTheDocument()
  })

  it('should call onReload when Reload is clicked', () => {
    const onReload = vi.fn()
    render(<ConflictWarning onReload={onReload} onDismiss={vi.fn()} />)

    fireEvent.click(screen.getByText('Reload'))
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('should call onDismiss when Dismiss is clicked', () => {
    const onDismiss = vi.fn()
    render(<ConflictWarning onReload={vi.fn()} onDismiss={onDismiss} />)

    fireEvent.click(screen.getByText('Dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
