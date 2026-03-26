import React, { useState, useEffect, useCallback } from 'react'
import type { ScribePlugin, PluginConfig } from 'scribe-react-common/src/plugins/types'
import { SCRIBE_PLUGIN_API_VERSION } from 'scribe-react-common/src/plugins/types'

const SELECTOR = '[data-plugin-wake-lock]'

function WakeLockButton() {
  const [enabled, setEnabled] = useState(true)
  const [sentinel, setSentinel] = useState<WakeLockSentinel | null>(null)
  const [supported] = useState(() => 'wakeLock' in navigator)

  const acquire = useCallback(async () => {
    if (!supported) return
    try {
      const s = await navigator.wakeLock.request('screen')
      setSentinel(s)
      s.addEventListener('release', () => setSentinel(null))
    } catch {
      // Not supported, denied, or page not visible
    }
  }, [supported])

  const release = useCallback(async () => {
    if (sentinel) {
      await sentinel.release()
      setSentinel(null)
    }
  }, [sentinel])

  // Acquire on mount (default on) and when enabled changes
  useEffect(() => {
    if (enabled) {
      acquire()
    } else {
      release()
    }
    return () => {
      // Release on unmount
      sentinel?.release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  // Re-acquire when page becomes visible again
  useEffect(() => {
    if (!enabled) return
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        acquire()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [enabled, acquire])

  const toggle = () => setEnabled(prev => !prev)

  const active = enabled && sentinel !== null

  if (!supported) {
    return (
      <div data-testid="wake-lock-status" className="wake-lock-container" style={containerStyle}>
        <span style={labelStyle}>Screen lock: <strong>unsupported</strong></span>
      </div>
    )
  }

  return (
    <button
      data-testid="wake-lock-toggle"
      onClick={toggle}
      style={{
        ...containerStyle,
        cursor: 'pointer',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        background: active ? '#ecfdf5' : '#fef2f2',
      }}
      title={enabled ? 'Screen wake lock is on — tap to turn off' : 'Screen wake lock is off — tap to turn on'}
    >
      <span style={{ fontSize: '16px' }}>{active ? '🔆' : '🌙'}</span>
      <span style={labelStyle}>
        Screen: <strong>{active ? 'On' : 'Off'}</strong>
      </span>
    </button>
  )
}

const containerStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 10px',
  fontSize: '13px',
  color: '#374151',
  marginBottom: '8px',
}

const labelStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
}

export { WakeLockButton }

export default function wakeLock(config: PluginConfig): ScribePlugin {
  const top = (config.top ?? 'true') !== 'false'

  return {
    name: 'wake-lock',
    apiVersion: SCRIBE_PLUGIN_API_VERSION,

    transformHtml(html: string): string {
      const placeholder = '<div data-plugin-wake-lock></div>'
      if (top) {
        // Insert after the first closing heading tag (the note title)
        const match = html.match(/<\/h[1-6]>/)
        if (match && match.index !== undefined) {
          const insertPos = match.index + match[0].length
          return html.slice(0, insertPos) + placeholder + html.slice(insertPos)
        }
        // No heading found — prepend
        return placeholder + html
      }
      // Bottom: append after all content
      return html + placeholder
    },

    mounts: [{
      selector: SELECTOR,
      Component: () => <WakeLockButton />,
    }],
  }
}
