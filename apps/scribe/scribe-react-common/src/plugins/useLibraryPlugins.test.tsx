import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import React from 'react'
import nacl from 'tweetnacl'
import { createHomeLibrary, createLibrary, setLibraryPlugins } from 'scribe-data'
import { createTestTributaryClient } from '../context/tributaryContext'
import { SCRIBE_PLUGIN_API_VERSION, type PluginEntry, type ScribePlugin } from './types'
import { useLibraryPlugins } from './useLibraryPlugins'

type LoadPluginFn = (entry: PluginEntry) => Promise<ScribePlugin | null>

function makePlugin(overrides: Partial<ScribePlugin> = {}): ScribePlugin {
  return {
    name: 'test-plugin',
    apiVersion: SCRIBE_PLUGIN_API_VERSION,
    ...overrides,
  }
}

describe('useLibraryPlugins', () => {
  let mockLoadPlugin: ReturnType<typeof vi.fn> & LoadPluginFn

  beforeEach(() => {
    mockLoadPlugin = vi.fn() as ReturnType<typeof vi.fn> & LoadPluginFn
  })

  async function createClientWithLibrary(name: string) {
    const { client } = createTestTributaryClient()
    const homeKeyPair = nacl.sign.keyPair()
    const { stream: homeStream } = await createHomeLibrary(client, 'Home', homeKeyPair)
    const { stream, streamId } = await createLibrary(client, name, homeStream)
    return { client, stream, streamId }
  }

  it('returns empty array when client is null', () => {
    const { result } = renderHook(() => useLibraryPlugins(null, 'some-id', mockLoadPlugin))
    expect(result.current).toEqual([])
  })

  it('returns empty array when libraryId is undefined', () => {
    const { client } = createTestTributaryClient()
    const { result } = renderHook(() => useLibraryPlugins(client, undefined, mockLoadPlugin))
    expect(result.current).toEqual([])
  })

  it('loads plugins from library config', async () => {
    const { client, stream, streamId } = await createClientWithLibrary('Test Lib')

    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/a.js', config_json: '{"mode":"always"}' },
      { plugin_url: 'https://example.com/b.js' },
    ])

    const pluginA = makePlugin({ name: 'plugin-a' })
    const pluginB = makePlugin({ name: 'plugin-b' })
    mockLoadPlugin
      .mockResolvedValueOnce(pluginA)
      .mockResolvedValueOnce(pluginB)

    const { result } = renderHook(() => useLibraryPlugins(client, streamId, mockLoadPlugin))

    await waitFor(() => {
      expect(result.current).toHaveLength(2)
    })

    expect(result.current[0].name).toBe('plugin-a')
    expect(result.current[1].name).toBe('plugin-b')

    // Verify loadPlugin was called with transformed entries
    expect(mockLoadPlugin).toHaveBeenCalledWith({
      url: 'https://example.com/a.js',
      config: { mode: 'always' },
    })
    expect(mockLoadPlugin).toHaveBeenCalledWith({
      url: 'https://example.com/b.js',
      config: {},
    })
  })

  it('filters out failed plugin loads (null results)', async () => {
    const { client, stream, streamId } = await createClientWithLibrary('Filter Lib')

    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/good.js' },
      { plugin_url: 'https://example.com/bad.js' },
      { plugin_url: 'https://example.com/also-good.js' },
    ])

    mockLoadPlugin
      .mockResolvedValueOnce(makePlugin({ name: 'good' }))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makePlugin({ name: 'also-good' }))

    const { result } = renderHook(() => useLibraryPlugins(client, streamId, mockLoadPlugin))

    await waitFor(() => {
      expect(result.current).toHaveLength(2)
    })

    expect(result.current[0].name).toBe('good')
    expect(result.current[1].name).toBe('also-good')
  })

  it('returns empty array when library has no plugins', async () => {
    const { client, streamId } = await createClientWithLibrary('Empty Lib')

    const { result } = renderHook(() => useLibraryPlugins(client, streamId, mockLoadPlugin))

    await waitFor(() => {
      expect(mockLoadPlugin).not.toHaveBeenCalled()
    })

    expect(result.current).toEqual([])
  })

  it('returns empty array when stream is not found', async () => {
    const { client } = createTestTributaryClient()

    const { result } = renderHook(() => useLibraryPlugins(client, 'nonexistent-stream-id', mockLoadPlugin))

    await new Promise(r => setTimeout(r, 100))
    expect(result.current).toEqual([])
    expect(mockLoadPlugin).not.toHaveBeenCalled()
  })

  it('passes config values through to loadPlugin', async () => {
    const { client, stream, streamId } = await createClientWithLibrary('Config Lib')

    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/plugin.js', config_json: '{"theme":"dark","size":"16"}' },
    ])

    mockLoadPlugin.mockResolvedValueOnce(makePlugin({ name: 'configured' }))

    const { result } = renderHook(() => useLibraryPlugins(client, streamId, mockLoadPlugin))

    await waitFor(() => {
      expect(result.current).toHaveLength(1)
    })

    expect(mockLoadPlugin).toHaveBeenCalledWith({
      url: 'https://example.com/plugin.js',
      config: { theme: 'dark', size: '16' },
    })
  })
})
