import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderHook, render, screen } from '@testing-library/react'
import { PluginProvider, usePlugins } from './pluginContext'
import { SCRIBE_PLUGIN_API_VERSION, type ScribePlugin } from '../plugins/types'

function makePlugin(overrides: Partial<ScribePlugin> = {}): ScribePlugin {
  return {
    name: 'test-plugin',
    apiVersion: SCRIBE_PLUGIN_API_VERSION,
    ...overrides,
  }
}

describe('usePlugins', () => {
  it('returns empty array when no provider', () => {
    const { result } = renderHook(() => usePlugins())
    expect(result.current).toEqual([])
  })

  it('returns provided plugins', () => {
    const plugins = [makePlugin({ name: 'alpha' }), makePlugin({ name: 'beta' })]
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PluginProvider plugins={plugins}>{children}</PluginProvider>
    )

    const { result } = renderHook(() => usePlugins(), { wrapper })
    expect(result.current).toHaveLength(2)
    expect(result.current[0].name).toBe('alpha')
    expect(result.current[1].name).toBe('beta')
  })
})

describe('PluginProvider Effect rendering', () => {
  it('renders Effect components when present', () => {
    const Effect = () => <div data-testid="effect-a">effect-a</div>
    const plugins = [makePlugin({ name: 'with-effect', Effect })]

    render(
      <PluginProvider plugins={plugins}>
        <div>child</div>
      </PluginProvider>
    )

    expect(screen.getByTestId('effect-a')).toBeInTheDocument()
  })

  it('does not render Effect when absent', () => {
    const plugins = [makePlugin({ name: 'no-effect' })]

    render(
      <PluginProvider plugins={plugins}>
        <div data-testid="child">child</div>
      </PluginProvider>
    )

    expect(screen.getByTestId('child')).toBeInTheDocument()
    // No extra elements beyond the child
  })

  it('renders multiple plugins Effects', () => {
    const EffectA = () => <div data-testid="effect-a">a</div>
    const EffectB = () => <div data-testid="effect-b">b</div>
    const plugins = [
      makePlugin({ name: 'plugin-a', Effect: EffectA }),
      makePlugin({ name: 'plugin-b', Effect: EffectB }),
    ]

    render(
      <PluginProvider plugins={plugins}>
        <div>child</div>
      </PluginProvider>
    )

    expect(screen.getByTestId('effect-a')).toBeInTheDocument()
    expect(screen.getByTestId('effect-b')).toBeInTheDocument()
  })

  it('renders children alongside Effects', () => {
    const Effect = () => <div data-testid="effect">effect</div>
    const plugins = [makePlugin({ name: 'p', Effect })]

    render(
      <PluginProvider plugins={plugins}>
        <div data-testid="child">child content</div>
      </PluginProvider>
    )

    expect(screen.getByTestId('effect')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })
})
