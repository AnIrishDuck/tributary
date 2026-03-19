import { test, expect, describe } from 'vitest'
import { TributaryClient, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import { createHomeLibrary } from '../src/library.js'
import { setFeatureFlag, getFeatureFlag, getFeatureFlags, deleteFeatureFlag } from '../src/feature-flag.js'

function makeClient(server?: FakeServer) {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  return { client, server: s }
}

describe('feature flags', () => {
  test('setFeatureFlag creates a new flag', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const flag = await setFeatureFlag(stream, 'dark-mode', 'enabled')

    expect(flag.flag_name).toBe('dark-mode')
    expect(flag.flag_value).toBe('enabled')
    expect(flag.inserter).toBe('user')
    expect(flag.insert_datetime).toBeDefined()
  })

  test('setFeatureFlag upserts an existing flag', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    await setFeatureFlag(stream, 'theme', 'light')
    const updated = await setFeatureFlag(stream, 'theme', 'dark')

    expect(updated.flag_value).toBe('dark')

    const all = await getFeatureFlags(stream)
    expect(all).toHaveLength(1)
    expect(all[0].flag_value).toBe('dark')
  })

  test('getFeatureFlag returns a flag by name', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    await setFeatureFlag(stream, 'beta', 'true')

    const flag = await getFeatureFlag(stream, 'beta')
    expect(flag).not.toBeNull()
    expect(flag!.flag_name).toBe('beta')
    expect(flag!.flag_value).toBe('true')
  })

  test('getFeatureFlag returns null for nonexistent flag', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const flag = await getFeatureFlag(stream, 'nonexistent')
    expect(flag).toBeNull()
  })

  test('getFeatureFlags returns all flags sorted by name', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    await setFeatureFlag(stream, 'zebra', 'z')
    await setFeatureFlag(stream, 'alpha', 'a')
    await setFeatureFlag(stream, 'middle', 'm')

    const flags = await getFeatureFlags(stream)
    expect(flags).toHaveLength(3)
    expect(flags[0].flag_name).toBe('alpha')
    expect(flags[1].flag_name).toBe('middle')
    expect(flags[2].flag_name).toBe('zebra')
  })

  test('getFeatureFlags returns empty array when no flags exist', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    const flags = await getFeatureFlags(stream)
    expect(flags).toEqual([])
  })

  test('deleteFeatureFlag removes a flag', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const { stream } = await createHomeLibrary(client, 'Home', keyPair)

    await setFeatureFlag(stream, 'temp', 'value')
    expect(await getFeatureFlag(stream, 'temp')).not.toBeNull()

    await deleteFeatureFlag(stream, 'temp')
    expect(await getFeatureFlag(stream, 'temp')).toBeNull()
  })
})
