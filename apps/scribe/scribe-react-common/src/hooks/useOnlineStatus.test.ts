import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useOnlineStatus } from './useOnlineStatus'

function setNavigatorOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  })
}

describe('useOnlineStatus', () => {
  beforeEach(() => {
    setNavigatorOnline(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('reports online when navigator.onLine is true', () => {
    const probe = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useOnlineStatus({ probe }))

    expect(result.current).toBe(true)
    // No probe needed when the browser already believes it is online.
    expect(probe).not.toHaveBeenCalled()
  })

  it('does not trust an offline event until a probe confirms it', async () => {
    // The browser fires `offline`, but the network is actually reachable —
    // the classic mobile false-offline scenario.
    const probe = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useOnlineStatus({ probe }))

    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })

    await waitFor(() => expect(probe).toHaveBeenCalled())
    // Probe confirmed connectivity, so we stay online.
    expect(result.current).toBe(true)
  })

  it('goes offline only when the probe confirms the network is unreachable', async () => {
    const probe = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() => useOnlineStatus({ probe }))

    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })

    await waitFor(() => expect(result.current).toBe(false))
  })

  it('verifies connectivity when navigator.onLine is false at mount', async () => {
    setNavigatorOnline(false)
    const probe = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useOnlineStatus({ probe }))

    // Starts pessimistic (matches navigator), then recovers after probing.
    expect(result.current).toBe(false)
    await waitFor(() => expect(result.current).toBe(true))
    expect(probe).toHaveBeenCalled()
  })

  it('returns to online when the browser fires an online event', async () => {
    const probe = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() => useOnlineStatus({ probe }))

    await act(async () => {
      window.dispatchEvent(new Event('offline'))
    })
    await waitFor(() => expect(result.current).toBe(false))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)
  })

  it('re-probes while offline and recovers when connectivity returns', async () => {
    vi.useFakeTimers()
    // Fail the initial probe, then succeed on the polled re-check.
    const probe = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)

    const { result } = renderHook(() => useOnlineStatus({ probe }))

    await act(async () => {
      window.dispatchEvent(new Event('offline'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current).toBe(false)

    // Advance past the recheck interval; the poll probe now succeeds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })

    expect(result.current).toBe(true)
  })

  it('re-verifies when the tab becomes visible', async () => {
    setNavigatorOnline(false)
    const probe = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() => useOnlineStatus({ probe }))

    await waitFor(() => expect(result.current).toBe(false))

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
    probe.mockResolvedValue(true)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(result.current).toBe(true))
  })
})
