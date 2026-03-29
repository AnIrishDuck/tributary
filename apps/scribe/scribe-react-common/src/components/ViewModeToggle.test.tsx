import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ViewModeToggle, ViewMode } from './ViewModeToggle'

describe('ViewModeToggle', () => {
  it('should render a single button', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="card" onModeChange={onModeChange} />)

    expect(screen.getByRole('button')).toBeInTheDocument()
  })

  it('should show list icon and switch-to-list label when in card mode', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="card" onModeChange={onModeChange} />)

    expect(screen.getByRole('button', { name: 'Switch to list view' })).toBeInTheDocument()
  })

  it('should show card icon and switch-to-card label when in list mode', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="list" onModeChange={onModeChange} />)

    expect(screen.getByRole('button', { name: 'Switch to card view' })).toBeInTheDocument()
  })

  it('should call onModeChange with list when clicked in card mode', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="card" onModeChange={onModeChange} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onModeChange).toHaveBeenCalledWith('list')
  })

  it('should call onModeChange with card when clicked in list mode', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="list" onModeChange={onModeChange} />)

    fireEvent.click(screen.getByRole('button'))

    expect(onModeChange).toHaveBeenCalledWith('card')
  })
})
