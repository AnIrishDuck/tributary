import { describe, it, expect, vi } from 'vitest'
import { loadPlugin } from './loadPlugin'
import { SCRIBE_PLUGIN_API_VERSION, type ScribePlugin } from './types'

function makePlugin(overrides: Partial<ScribePlugin> = {}): ScribePlugin {
  return {
    name: 'test-plugin',
    apiVersion: SCRIBE_PLUGIN_API_VERSION,
    ...overrides,
  }
}

describe('loadPlugin', () => {
  it('calls factory with provided config', async () => {
    const factory = vi.fn(() => makePlugin())
    const importFn = vi.fn(async () => ({ default: factory }))

    await loadPlugin({ url: 'https://example.com/plugin.js', config: { mode: 'always' } }, importFn)

    expect(factory).toHaveBeenCalledWith({ mode: 'always' })
  })

  it('passes empty config when none provided', async () => {
    const factory = vi.fn(() => makePlugin())
    const importFn = vi.fn(async () => ({ default: factory }))

    await loadPlugin({ url: 'https://example.com/plugin.js' }, importFn)

    expect(factory).toHaveBeenCalledWith({})
  })

  it('returns valid plugin when everything matches', async () => {
    const plugin = makePlugin({ name: 'my-plugin' })
    const importFn = vi.fn(async () => ({ default: () => plugin }))

    const result = await loadPlugin({ url: 'https://example.com/plugin.js' }, importFn)

    expect(result).toBe(plugin)
    expect(result!.name).toBe('my-plugin')
  })

  it('rejects plugin with wrong apiVersion (returns null, logs error)', async () => {
    const plugin = makePlugin({ apiVersion: 999 as any })
    const importFn = vi.fn(async () => ({ default: () => plugin }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await loadPlugin({ url: 'https://example.com/plugin.js' }, importFn)

    expect(result).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('API v999'),
    )

    errorSpy.mockRestore()
  })

  it('rejects module with no default export (returns null, logs error)', async () => {
    const importFn = vi.fn(async () => ({ notDefault: 'oops' }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await loadPlugin({ url: 'https://example.com/plugin.js' }, importFn)

    expect(result).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('no default export function'),
    )

    errorSpy.mockRestore()
  })

  it('returns null when import throws', async () => {
    const importFn = vi.fn(async () => { throw new Error('network error') })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await loadPlugin({ url: 'https://example.com/plugin.js' }, importFn)

    expect(result).toBeNull()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load plugin'),
      expect.any(Error),
    )

    errorSpy.mockRestore()
  })
})
