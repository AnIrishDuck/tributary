import { describe, it, expect, beforeEach } from 'vitest'
import { TributaryClient, FakeServer } from 'tributary-client'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import { syncedMigrations, localMigrations, schemaReady } from '../src/migrations'

function makeClient(server?: FakeServer) {
  const s = server ?? new FakeServer()
  const pglite = new PGlite('memory://')
  const client = new TributaryClient({ server: s, db: pglite })
  return { client, server: s }
}

describe('schemaReady', () => {
  it('returns false when no migrations have been run', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    const ready = await schemaReady(stream)
    expect(ready).toBe(false)
  })

  it('returns true after syncedMigrations have been applied', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    await syncedMigrations(stream)

    const ready = await schemaReady(stream)
    expect(ready).toBe(true)
  })

  it('returns true after full migrations (synced + local)', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    await syncedMigrations(stream)
    await localMigrations(stream.local())

    const ready = await schemaReady(stream)
    expect(ready).toBe(true)
  })

  it('returns false when only local migrations have been run (no synced tables)', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    await localMigrations(stream.local())

    const ready = await schemaReady(stream)
    expect(ready).toBe(false)
  })

  it('works via TributaryLocal (stream.local())', async () => {
    const { client } = makeClient()
    const keyPair = nacl.sign.keyPair()
    const stream = await client.addWriteKey('scribe', keyPair.secretKey)

    // Before migrations — local DB also cannot see synced tables
    const localDb = stream.local()
    expect(await schemaReady(localDb)).toBe(false)

    // After synced migrations — local DB shares the same PGlite schema
    await syncedMigrations(stream)
    expect(await schemaReady(localDb)).toBe(true)
  })

  it('returns true on a fresh client after syncing a library with schema', async () => {
    const server = new FakeServer()

    // Client 1: create library with full migrations
    const { client: client1 } = makeClient(server)
    const keyPair = nacl.sign.keyPair()
    const stream1 = await client1.addWriteKey('scribe', keyPair.secretKey)
    await syncedMigrations(stream1)
    await stream1.sync(1000)

    // Client 2: sync the same library from scratch
    const { client: client2 } = makeClient(server)
    const stream2 = await client2.addWriteKey('scribe', keyPair.secretKey)

    // Before sync, schema should not be ready
    expect(await schemaReady(stream2)).toBe(false)

    // After sync, schema should be ready (synced migrations arrive via sync)
    await stream2.sync(1000)
    expect(await schemaReady(stream2)).toBe(true)
  })
})
