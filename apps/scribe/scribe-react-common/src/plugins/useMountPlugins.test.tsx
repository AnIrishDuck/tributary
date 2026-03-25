import { describe, it, expect, vi } from 'vitest'
import React, { useRef } from 'react'
import { render, act } from '@testing-library/react'
import { useMountPlugins } from './useMountPlugins'
import { SCRIBE_PLUGIN_API_VERSION, type ScribePlugin } from './types'

function makePlugin(overrides: Partial<ScribePlugin> = {}): ScribePlugin {
  return {
    name: 'test-plugin',
    apiVersion: SCRIBE_PLUGIN_API_VERSION,
    ...overrides,
  }
}

function TestHarness({
  plugins,
  innerHTML,
}: {
  plugins: ScribePlugin[]
  innerHTML: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useMountPlugins(ref, plugins)
  return <div ref={ref} dangerouslySetInnerHTML={{ __html: innerHTML }} />
}

describe('useMountPlugins', () => {
  it('mounts component into element matching selector', () => {
    const Component = ({ element }: { element: HTMLElement }) => (
      <span data-testid="mounted">mounted</span>
    )
    const plugins = [makePlugin({ mounts: [{ selector: '.mount-here', Component }] })]

    const { getByTestId } = render(
      <TestHarness plugins={plugins} innerHTML='<div class="mount-here"></div>' />
    )

    expect(getByTestId('mounted')).toBeInTheDocument()
  })

  it('passes element to Component as prop', () => {
    const receivedElements: HTMLElement[] = []
    const Component = ({ element }: { element: HTMLElement }) => {
      receivedElements.push(element)
      return <span>ok</span>
    }
    const plugins = [makePlugin({ mounts: [{ selector: '.target', Component }] })]

    render(
      <TestHarness plugins={plugins} innerHTML='<div class="target"></div>' />
    )

    expect(receivedElements).toHaveLength(1)
    expect(receivedElements[0]).toBeInstanceOf(HTMLElement)
    expect(receivedElements[0].classList.contains('target')).toBe(true)
  })

  it('handles multiple selectors from multiple plugins', () => {
    const ComponentA = () => <span data-testid="mount-a">a</span>
    const ComponentB = () => <span data-testid="mount-b">b</span>
    const plugins = [
      makePlugin({ name: 'p-a', mounts: [{ selector: '.slot-a', Component: ComponentA }] }),
      makePlugin({ name: 'p-b', mounts: [{ selector: '.slot-b', Component: ComponentB }] }),
    ]

    const { getByTestId } = render(
      <TestHarness
        plugins={plugins}
        innerHTML='<div class="slot-a"></div><div class="slot-b"></div>'
      />
    )

    expect(getByTestId('mount-a')).toBeInTheDocument()
    expect(getByTestId('mount-b')).toBeInTheDocument()
  })

  it('cleans up React roots on unmount', () => {
    const mountCount = { current: 0 }
    const Component = () => {
      React.useEffect(() => {
        mountCount.current++
        return () => { mountCount.current-- }
      }, [])
      return <span>mounted</span>
    }
    const plugins = [makePlugin({ mounts: [{ selector: '.cleanup', Component }] })]

    const { unmount } = render(
      <TestHarness plugins={plugins} innerHTML='<div class="cleanup"></div>' />
    )

    expect(mountCount.current).toBe(1)

    act(() => {
      unmount()
    })

    expect(mountCount.current).toBe(0)
  })

  it('does nothing when no mounts defined', () => {
    const plugins = [makePlugin({ name: 'no-mounts' })]

    const { container } = render(
      <TestHarness plugins={plugins} innerHTML='<div class="something"></div>' />
    )

    // Container should just have the raw HTML, no extra mounts
    expect(container.querySelector('.something')).toBeInTheDocument()
  })

  it('does nothing when no matching elements exist', () => {
    const Component = () => <span data-testid="should-not-appear">nope</span>
    const plugins = [makePlugin({ mounts: [{ selector: '.nonexistent', Component }] })]

    const { queryByTestId } = render(
      <TestHarness plugins={plugins} innerHTML='<div class="other"></div>' />
    )

    expect(queryByTestId('should-not-appear')).toBeNull()
  })
})
