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

  it('rejects plugin with wrong apiVersion (returns null)', async () => {
    const plugin = makePlugin({ apiVersion: 999 as any })
    const importFn = vi.fn(async () => ({ default: () => plugin }))

    const result = await loadPlugin({ url: 'https://example.com/plugin.js' }, importFn)

    expect(result).toBeNull()
  })

  it('rejects module with no default export (returns null)', async () => {
    const importFn = vi.fn(async () => ({ notDefault: 'oops' }))

    const result = await loadPlugin({ url: 'https://example.com/plugin.js' }, importFn)

    expect(result).toBeNull()
  })

  it('returns null when import throws', async () => {
    const importFn = vi.fn(async () => { throw new Error('network error') })

    const result = await loadPlugin({ url: 'https://example.com/plugin.js' }, importFn)

    expect(result).toBeNull()
  })
})
