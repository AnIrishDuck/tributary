import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ViewModeToggle, ViewMode } from './ViewModeToggle'

describe('ViewModeToggle', () => {
  it('should render both card and list buttons', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="card" onModeChange={onModeChange} />)

    expect(screen.getByRole('button', { name: 'Card view' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List view' })).toBeInTheDocument()
  })

  it('should highlight card button when mode is card', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="card" onModeChange={onModeChange} />)

    const cardButton = screen.getByRole('button', { name: 'Card view' })
    const listButton = screen.getByRole('button', { name: 'List view' })

    // Active button should not have gray text; inactive should
    expect(cardButton.className).not.toContain('text-gray-500')
    expect(listButton.className).toContain('text-gray-500')
  })

  it('should highlight list button when mode is list', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="list" onModeChange={onModeChange} />)

    const cardButton = screen.getByRole('button', { name: 'Card view' })
    const listButton = screen.getByRole('button', { name: 'List view' })

    expect(listButton.className).not.toContain('text-gray-500')
    expect(cardButton.className).toContain('text-gray-500')
  })

  it('should call onModeChange with list when list button is clicked', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="card" onModeChange={onModeChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'List view' }))

    expect(onModeChange).toHaveBeenCalledWith('list')
  })

  it('should call onModeChange with card when card button is clicked', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="list" onModeChange={onModeChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Card view' }))

    expect(onModeChange).toHaveBeenCalledWith('card')
  })

  it('should call onModeChange even when clicking the already-active mode', () => {
    const onModeChange = vi.fn()
    render(<ViewModeToggle mode="card" onModeChange={onModeChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Card view' }))

    expect(onModeChange).toHaveBeenCalledWith('card')
  })
})
