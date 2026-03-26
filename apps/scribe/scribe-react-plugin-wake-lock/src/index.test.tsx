import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import wakeLock, { WakeLockButton } from './index'
import { SCRIBE_PLUGIN_API_VERSION } from 'scribe-react-common/src/plugins/types'

// --- Factory tests ---

describe('wakeLock factory', () => {
  it('returns a plugin with correct name and apiVersion', () => {
    const plugin = wakeLock({})
    expect(plugin.name).toBe('wake-lock')
    expect(plugin.apiVersion).toBe(SCRIBE_PLUGIN_API_VERSION)
  })

  it('has transformHtml and mounts', () => {
    const plugin = wakeLock({})
    expect(plugin.transformHtml).toBeDefined()
    expect(plugin.mounts).toHaveLength(1)
    expect(plugin.mounts![0].selector).toBe('[data-plugin-wake-lock]')
  })

  it('does not have micromark, codemirror, or Effect', () => {
    const plugin = wakeLock({})
    expect(plugin.micromark).toBeUndefined()
    expect(plugin.codemirror).toBeUndefined()
    expect(plugin.Effect).toBeUndefined()
  })
})

// --- transformHtml tests ---

describe('transformHtml', () => {
  it('inserts placeholder after first heading when top (default)', () => {
    const plugin = wakeLock({})
    const html = '<h1>My Note</h1><p>Content here</p>'
    const result = plugin.transformHtml!(html)
    expect(result).toBe(
      '<h1>My Note</h1><div data-plugin-wake-lock></div><p>Content here</p>'
    )
  })

  it('inserts placeholder after first heading with explicit top: "true"', () => {
    const plugin = wakeLock({ top: 'true' })
    const html = '<h2>Title</h2><p>Body</p>'
    const result = plugin.transformHtml!(html)
    expect(result).toBe(
      '<h2>Title</h2><div data-plugin-wake-lock></div><p>Body</p>'
    )
  })

  it('appends placeholder at end when top: "false"', () => {
    const plugin = wakeLock({ top: 'false' })
    const html = '<h1>My Note</h1><p>Content here</p>'
    const result = plugin.transformHtml!(html)
    expect(result).toBe(
      '<h1>My Note</h1><p>Content here</p><div data-plugin-wake-lock></div>'
    )
  })

  it('prepends placeholder when top and no heading found', () => {
    const plugin = wakeLock({ top: 'true' })
    const html = '<p>No heading</p>'
    const result = plugin.transformHtml!(html)
    expect(result).toBe(
      '<div data-plugin-wake-lock></div><p>No heading</p>'
    )
  })

  it('handles empty html', () => {
    const plugin = wakeLock({})
    expect(plugin.transformHtml!('')).toBe('<div data-plugin-wake-lock></div>')
  })
})

// --- WakeLockButton tests ---

describe('WakeLockButton', () => {
  let mockSentinel: { release: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockSentinel = {
      release: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
    }

    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        request: vi.fn().mockResolvedValue(mockSentinel),
      },
      writable: true,
      configurable: true,
    })
  })

  it('acquires wake lock on mount (defaults to on)', async () => {
    await act(async () => {
      render(<WakeLockButton />)
    })

    expect(navigator.wakeLock.request).toHaveBeenCalledWith('screen')
  })

  it('shows active state when wake lock is acquired', async () => {
    await act(async () => {
      render(<WakeLockButton />)
    })

    const button = screen.getByTestId('wake-lock-toggle')
    expect(button.textContent).toContain('Screen:')
    expect(button.textContent).toContain('On')
  })

  it('toggles off when clicked', async () => {
    const user = userEvent.setup()

    await act(async () => {
      render(<WakeLockButton />)
    })

    const button = screen.getByTestId('wake-lock-toggle')
    await user.click(button)

    expect(mockSentinel.release).toHaveBeenCalled()
    expect(button.textContent).toContain('Off')
  })

  it('shows unsupported message when wake lock API is unavailable', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      writable: true,
      configurable: true,
    })

    // Need to re-render since supported is checked in useState initializer
    // We create a fresh component that will evaluate the check
    const { unmount } = render(<WakeLockButton />)
    unmount()

    // Re-define as missing and render again
    delete (navigator as Record<string, unknown>).wakeLock
    await act(async () => {
      render(<WakeLockButton />)
    })

    expect(screen.getByTestId('wake-lock-status').textContent).toContain('unsupported')
  })
})
