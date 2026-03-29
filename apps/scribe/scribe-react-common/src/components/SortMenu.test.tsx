import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SortMenu, SortOptions } from './SortMenu'

describe('SortMenu', () => {
  it('should render sort button', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'modified', order: 'desc' }} onSortChange={onSortChange} />)

    expect(screen.getByRole('button', { name: 'Sort' })).toBeInTheDocument()
  })

  it('should not show dropdown initially', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'modified', order: 'desc' }} onSortChange={onSortChange} />)

    expect(screen.queryByText('Sort by')).not.toBeInTheDocument()
  })

  it('should open dropdown when clicked', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'modified', order: 'desc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))

    expect(screen.getByText('Sort by')).toBeInTheDocument()
    expect(screen.getByText('Order')).toBeInTheDocument()
    expect(screen.getByText('Alphabetical')).toBeInTheDocument()
    expect(screen.getByText('Modification time')).toBeInTheDocument()
  })

  it('should close dropdown when clicking toggle again', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'modified', order: 'desc' }} onSortChange={onSortChange} />)

    const button = screen.getByRole('button', { name: 'Sort' })
    fireEvent.click(button)
    expect(screen.getByText('Sort by')).toBeInTheDocument()

    fireEvent.click(button)
    expect(screen.queryByText('Sort by')).not.toBeInTheDocument()
  })

  it('should close dropdown when clicking outside', () => {
    const onSortChange = vi.fn()
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <SortMenu sort={{ type: 'modified', order: 'desc' }} onSortChange={onSortChange} />
      </div>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    expect(screen.getByText('Sort by')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByText('Sort by')).not.toBeInTheDocument()
  })

  it('should show time-based order options when sort type is modified', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'modified', order: 'desc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))

    expect(screen.getByText('Oldest to newest')).toBeInTheDocument()
    expect(screen.getByText('Newest to oldest')).toBeInTheDocument()
    expect(screen.queryByText('A to Z')).not.toBeInTheDocument()
    expect(screen.queryByText('Z to A')).not.toBeInTheDocument()
  })

  it('should show alphabetical order options when sort type is alphabetical', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'alphabetical', order: 'asc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))

    expect(screen.getByText('A to Z')).toBeInTheDocument()
    expect(screen.getByText('Z to A')).toBeInTheDocument()
    expect(screen.queryByText('Oldest to newest')).not.toBeInTheDocument()
    expect(screen.queryByText('Newest to oldest')).not.toBeInTheDocument()
  })

  it('should call onSortChange when switching to alphabetical', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'modified', order: 'desc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByText('Alphabetical'))

    expect(onSortChange).toHaveBeenCalledWith({ type: 'alphabetical', order: 'asc' })
  })

  it('should call onSortChange when switching to modification time', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'alphabetical', order: 'asc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByText('Modification time'))

    expect(onSortChange).toHaveBeenCalledWith({ type: 'modified', order: 'desc' })
  })

  it('should preserve current order when clicking already-selected sort type', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'alphabetical', order: 'desc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByText('Alphabetical'))

    expect(onSortChange).toHaveBeenCalledWith({ type: 'alphabetical', order: 'desc' })
  })

  it('should call onSortChange when changing order to ascending', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'modified', order: 'desc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByText('Oldest to newest'))

    expect(onSortChange).toHaveBeenCalledWith({ type: 'modified', order: 'asc' })
  })

  it('should call onSortChange when changing order to descending', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'modified', order: 'asc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByText('Newest to oldest'))

    expect(onSortChange).toHaveBeenCalledWith({ type: 'modified', order: 'desc' })
  })

  it('should call onSortChange for alphabetical Z to A', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'alphabetical', order: 'asc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByText('Z to A'))

    expect(onSortChange).toHaveBeenCalledWith({ type: 'alphabetical', order: 'desc' })
  })

  it('should default to asc when switching from modified to alphabetical', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'modified', order: 'desc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByText('Alphabetical'))

    expect(onSortChange).toHaveBeenCalledWith({ type: 'alphabetical', order: 'asc' })
  })

  it('should default to desc when switching from alphabetical to modified', () => {
    const onSortChange = vi.fn()
    render(<SortMenu sort={{ type: 'alphabetical', order: 'asc' }} onSortChange={onSortChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }))
    fireEvent.click(screen.getByText('Modification time'))

    expect(onSortChange).toHaveBeenCalledWith({ type: 'modified', order: 'desc' })
  })
})
