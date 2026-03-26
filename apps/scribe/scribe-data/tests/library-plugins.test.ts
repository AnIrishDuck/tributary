import { test, expect, describe } from 'vitest'
import { TributaryClient, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import { createHomeLibrary, getLibraryPlugins, setLibraryPlugins } from '../src/library.js'

function makeClient(server?: FakeServer) {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  return { client, server: s }
}

describe('library plugin storage', () => {
  test('new library has empty plugins', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const plugins = await getLibraryPlugins(stream)
    expect(plugins).toEqual([])
  })

  test('set and retrieve plugin entries', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/plugin-a.js', config_json: '{"mode":"always"}' },
      { plugin_url: 'https://example.com/plugin-b.js' },
    ])

    const plugins = await getLibraryPlugins(stream)
    expect(plugins).toHaveLength(2)
    expect(plugins[0].plugin_url).toBe('https://example.com/plugin-a.js')
    expect(plugins[0].config_json).toBe('{"mode":"always"}')
    expect(plugins[0].sort_order).toBe(0)
    expect(plugins[1].plugin_url).toBe('https://example.com/plugin-b.js')
    expect(plugins[1].config_json).toBe('{}')
    expect(plugins[1].sort_order).toBe(1)
  })

  test('config is round-tripped correctly as JSON', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const config = { theme: 'dark', size: '16', nested: '{"a":1}' }
    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/plugin.js', config_json: JSON.stringify(config) },
    ])

    const plugins = await getLibraryPlugins(stream)
    expect(plugins).toHaveLength(1)
    const parsed = JSON.parse(plugins[0].config_json)
    expect(parsed).toEqual(config)
  })

  test('replacing plugins list replaces all entries', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    // Set initial plugins
    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/old-a.js' },
      { plugin_url: 'https://example.com/old-b.js' },
    ])

    // Replace with new plugins
    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/new-x.js', config_json: '{"key":"val"}' },
    ])

    const plugins = await getLibraryPlugins(stream)
    expect(plugins).toHaveLength(1)
    expect(plugins[0].plugin_url).toBe('https://example.com/new-x.js')
    expect(plugins[0].config_json).toBe('{"key":"val"}')
    expect(plugins[0].sort_order).toBe(0)
  })

  test('plugin order is preserved via sort_order', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    await setLibraryPlugins(stream, [
      { plugin_url: 'https://example.com/first.js' },
      { plugin_url: 'https://example.com/second.js' },
      { plugin_url: 'https://example.com/third.js' },
    ])

    const plugins = await getLibraryPlugins(stream)
    expect(plugins).toHaveLength(3)
    expect(plugins[0].plugin_url).toBe('https://example.com/first.js')
    expect(plugins[0].sort_order).toBe(0)
    expect(plugins[1].plugin_url).toBe('https://example.com/second.js')
    expect(plugins[1].sort_order).toBe(1)
    expect(plugins[2].plugin_url).toBe('https://example.com/third.js')
    expect(plugins[2].sort_order).toBe(2)
  })
})
