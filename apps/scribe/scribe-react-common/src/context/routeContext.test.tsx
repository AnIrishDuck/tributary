import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { renderHook } from '@testing-library/react'
import { RouteContextProvider, useRouteContext, useRouteContextOptional } from './routeContext'

describe('RouteContextProvider', () => {
  describe('pk paradigm', () => {
    const prefix = '_ip1xGnAiIyjoI2RRX5xmAVei607S-s3rvTmEgFQ-k0'

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RouteContextProvider paradigm="pk" prefix={prefix}>
        {children}
      </RouteContextProvider>
    )

    it('should provide pk paradigm', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.paradigm).toBe('pk')
    })

    it('should provide the prefix', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.prefix).toBe(prefix)
    })

    it('should build library root path', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.buildPath()).toBe(`/pk/${prefix}/`)
    })

    it('should build slug path', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.buildPath('my-note')).toBe(`/pk/${prefix}/my-note`)
    })

    it('should build nested slug path', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.buildPath('collection/my-note')).toBe(`/pk/${prefix}/collection/my-note`)
    })

    it('should build path with action suffix', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.buildPath('my-note&edit')).toBe(`/pk/${prefix}/my-note&edit`)
    })

    it('should ignore namedBase for pk paradigm', () => {
      const wrapperWithNamedBase = ({ children }: { children: React.ReactNode }) => (
        <RouteContextProvider paradigm="pk" prefix={prefix} namedBase="/n/my-library">
          {children}
        </RouteContextProvider>
      )
      const { result } = renderHook(() => useRouteContext(), { wrapper: wrapperWithNamedBase })
      expect(result.current.buildPath('note')).toBe(`/pk/${prefix}/note`)
    })
  })

  describe('named paradigm', () => {
    const prefix = '_ip1xGnAiIyjoI2RRX5xmAVei607S-s3rvTmEgFQ-k0'
    const namedBase = '/n/my-recipes'

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RouteContextProvider paradigm="named" prefix={prefix} namedBase={namedBase}>
        {children}
      </RouteContextProvider>
    )

    it('should provide named paradigm', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.paradigm).toBe('named')
    })

    it('should still provide the stream prefix', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.prefix).toBe(prefix)
    })

    it('should build library root path using named base', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.buildPath()).toBe('/n/my-recipes/')
    })

    it('should build slug path using named base', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.buildPath('soup')).toBe('/n/my-recipes/soup')
    })

    it('should build nested slug path using named base', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.buildPath('dinner/soup')).toBe('/n/my-recipes/dinner/soup')
    })

    it('should build path with action suffix using named base', () => {
      const { result } = renderHook(() => useRouteContext(), { wrapper })
      expect(result.current.buildPath('soup&edit')).toBe('/n/my-recipes/soup&edit')
    })

    it('should fall back to pk base when namedBase is missing', () => {
      const wrapperNoBase = ({ children }: { children: React.ReactNode }) => (
        <RouteContextProvider paradigm="named" prefix={prefix}>
          {children}
        </RouteContextProvider>
      )
      const { result } = renderHook(() => useRouteContext(), { wrapper: wrapperNoBase })
      expect(result.current.buildPath('note')).toBe(`/pk/${prefix}/note`)
    })
  })
})

describe('useRouteContext', () => {
  it('should throw when used outside provider', () => {
    // Suppress console.error from React for the expected error
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => {
      renderHook(() => useRouteContext())
    }).toThrow('useRouteContext must be used within a RouteContextProvider')
    spy.mockRestore()
  })
})

describe('useRouteContextOptional', () => {
  it('should return null when used outside provider', () => {
    const { result } = renderHook(() => useRouteContextOptional())
    expect(result.current).toBeNull()
  })

  it('should return context value when inside provider', () => {
    const prefix = 'test-prefix'
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RouteContextProvider paradigm="pk" prefix={prefix}>
        {children}
      </RouteContextProvider>
    )
    const { result } = renderHook(() => useRouteContextOptional(), { wrapper })
    expect(result.current).not.toBeNull()
    expect(result.current!.paradigm).toBe('pk')
    expect(result.current!.prefix).toBe(prefix)
  })
})
