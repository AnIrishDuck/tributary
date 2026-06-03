import { useState, useEffect, useRef } from 'react'

/** How long to wait for a connectivity probe before treating it as failed. */
const PROBE_TIMEOUT_MS = 5000

/**
 * How often to re-probe connectivity while we believe we are offline.
 *
 * Mobile browsers frequently fail to fire the `online` event when the
 * connection is restored, so polling is the only reliable way to recover.
 */
const RECHECK_INTERVAL_MS = 15000

export interface UseOnlineStatusOptions {
  /**
   * Performs an actual connectivity check, resolving `true` when the network
   * is reachable. Overridable for testing; defaults to a no-cache request
   * against the app's own origin.
   */
  probe?: () => Promise<boolean>
}

/**
 * Probe connectivity by hitting the app's own origin. Any HTTP response —
 * even a 404 — proves we reached the server, so we only treat a thrown
 * error (network failure / timeout) as offline. `cache: 'no-store'` ensures
 * we hit the network rather than a service-worker / HTTP cache.
 */
async function defaultProbe(): Promise<boolean> {
  if (typeof fetch === 'undefined' || typeof window === 'undefined') {
    return true
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    await fetch(`${window.location.origin}/favicon.ico?_=${Date.now()}`, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Tracks whether the app has network connectivity.
 *
 * `navigator.onLine` is unreliable on mobile browsers and PWAs: it commonly
 * reports `false` while connectivity is perfectly fine (e.g. when the app is
 * relaunched from the background), and the `online`/`offline` events fire
 * inconsistently. To avoid showing a spurious "offline" banner, we never
 * trust a `false` reading on its own — we confirm it with a real network
 * probe, and keep re-probing while offline so we recover even if the `online`
 * event never fires.
 */
export function useOnlineStatus(options: UseOnlineStatusOptions = {}): boolean {
  const probeRef = useRef(options.probe ?? defaultProbe)
  probeRef.current = options.probe ?? defaultProbe

  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  useEffect(() => {
    let cancelled = false

    const verify = async () => {
      const reachable = await probeRef.current()
      if (!cancelled) setIsOnline(reachable)
    }

    // The browser reporting `online` is trustworthy enough to act on directly.
    const handleOnline = () => {
      if (!cancelled) setIsOnline(true)
    }

    // A `false` reading from the browser is not reliable, so confirm it with a
    // real probe before flipping the UI to offline.
    const handleOffline = () => {
      void verify()
    }

    // Returning from the background often leaves `navigator.onLine` stale on
    // mobile. Re-verify whenever the tab becomes visible.
    const handleVisibility = () => {
      if (
        typeof document !== 'undefined' &&
        document.visibilityState === 'visible'
      ) {
        void verify()
      }
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility)
    }

    // If the browser claims to be offline at mount, verify rather than trust.
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      void verify()
    }

    return () => {
      cancelled = true
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility)
      }
    }
  }, [])

  // While we believe we're offline, poll to recover — the `online` event is
  // unreliable on mobile, so this is often the only way back to online.
  useEffect(() => {
    if (isOnline) return

    let cancelled = false
    const interval = setInterval(async () => {
      const reachable = await probeRef.current()
      if (!cancelled && reachable) setIsOnline(true)
    }, RECHECK_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [isOnline])

  return isOnline
}
