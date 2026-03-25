import { useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import type { ScribePlugin } from './types'

export function useMountPlugins(
  containerRef: React.RefObject<HTMLElement | null>,
  plugins: ScribePlugin[]
): void {
  const rootsRef = useRef<Root[]>([])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const roots: Root[] = []

    for (const plugin of plugins) {
      if (!plugin.mounts) continue
      for (const mount of plugin.mounts) {
        const elements = container.querySelectorAll(mount.selector)
        for (const element of elements) {
          const root = createRoot(element)
          root.render(React.createElement(mount.Component, { element: element as HTMLElement }))
          roots.push(root)
        }
      }
    }

    rootsRef.current = roots

    return () => {
      for (const root of roots) {
        root.unmount()
      }
      rootsRef.current = []
    }
  }, [containerRef, plugins])
}
