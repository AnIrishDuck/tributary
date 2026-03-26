import React from 'react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { RouteContextProvider } from 'scribe-react-common/src/context/routeContext'
import ImageDialog from '../src/components/ImageDialog'

// jsdom doesn't have URL.createObjectURL
beforeAll(() => {
  if (!URL.createObjectURL) {
    URL.createObjectURL = vi.fn(() => 'blob:test-url')
  }
  if (!URL.revokeObjectURL) {
    URL.revokeObjectURL = vi.fn()
  }
})

function renderDialog(props: Partial<React.ComponentProps<typeof ImageDialog>> = {}) {
  const defaults: React.ComponentProps<typeof ImageDialog> = {
    prefix: 'test-prefix',
    ancestors: [],
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...props,
  }
  return render(
    <MemoryRouter>
      <RouteContextProvider paradigm="pk" prefix="test-prefix">
        <ImageDialog {...defaults} />
      </RouteContextProvider>
    </MemoryRouter>
  )
}

describe('ImageDialog', () => {
  it('renders with required fields', () => {
    renderDialog()

    expect(screen.getByText('Add Image')).toBeDefined()
    expect(screen.getByLabelText(/slug/i)).toBeDefined()
    expect(screen.getByLabelText(/title/i)).toBeDefined()
    expect(screen.getByText(/click to select or drag and drop/i)).toBeDefined()
  })

  it('renders cancel button that calls onCancel', async () => {
    const onCancel = vi.fn()
    renderDialog({ onCancel })

    await userEvent.click(screen.getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('auto-derives slug from file name on file selection', async () => {
    renderDialog()

    const file = new File(['image data'], 'My Vacation Photo.png', { type: 'image/png' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement

    fireEvent.change(fileInput, { target: { files: [file] } })

    const slugInput = screen.getByLabelText(/slug/i) as HTMLInputElement
    expect(slugInput.value).toBe('my-vacation-photo')
  })

  it('validates slug format — spaces become hyphens, special chars stripped', async () => {
    renderDialog()

    const slugInput = screen.getByLabelText(/slug/i) as HTMLInputElement

    await userEvent.clear(slugInput)
    await userEvent.type(slugInput, 'Hello World')

    expect(slugInput.value).toBe('hello-world')
  })

  it('shows error when saving without a file', async () => {
    const onSave = vi.fn()
    renderDialog({ onSave })

    await userEvent.click(screen.getByLabelText('Save Image'))

    expect(screen.getByText('Please select an image')).toBeDefined()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows error when saving without a slug', async () => {
    const onSave = vi.fn()
    renderDialog({ onSave })

    const file = new File(['data'], 'test.png', { type: 'image/png' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })

    // Clear the auto-generated slug
    const slugInput = screen.getByLabelText(/slug/i) as HTMLInputElement
    await userEvent.clear(slugInput)

    await userEvent.click(screen.getByLabelText('Save Image'))

    expect(screen.getByText('Slug is required')).toBeDefined()
    expect(onSave).not.toHaveBeenCalled()
  })
})
