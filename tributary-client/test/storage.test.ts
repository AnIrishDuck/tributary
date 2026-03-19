import { describe, it, expect, beforeEach } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import nacl from 'tweetnacl'
import * as base64url from 'urlsafe-base64'
import { createTestServer, createTestClient, estimateStreamStorageBytes, estimateQuota } from '../src/index'

describe('estimateStreamStorageBytes', () => {
  it('returns zero for an empty schema', async () => {
    const pglite = new PGlite('memory://')
    await pglite.exec('CREATE SCHEMA IF NOT EXISTS empty_test')

    const { estimatedBytes, rowCount } = await estimateStreamStorageBytes(pglite, 'empty_test')
    expect(estimatedBytes).toBe(0)
    expect(rowCount).toBe(0)
  })

  it('returns non-zero estimate for a schema with data', async () => {
    const pglite = new PGlite('memory://')
    await pglite.exec('CREATE SCHEMA IF NOT EXISTS test_data')
    await pglite.exec(`
      CREATE TABLE test_data.items (
        id TEXT PRIMARY KEY,
        body TEXT NOT NULL
      )
    `)

    for (let i = 0; i < 10; i++) {
      await pglite.query(
        `INSERT INTO test_data.items (id, body) VALUES ($1, $2)`,
        [`item-${i}`, `Body content for item ${i} with some extra text.`]
      )
    }

    const { estimatedBytes, rowCount } = await estimateStreamStorageBytes(pglite, 'test_data')
    expect(estimatedBytes).toBeGreaterThan(0)
    expect(rowCount).toBe(10)
  })

  it('estimate grows proportionally with more data', async () => {
    const pglite = new PGlite('memory://')

    for (const schema of ['small_schema', 'large_schema']) {
      await pglite.exec(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)
      await pglite.exec(`CREATE TABLE "${schema}".items (id TEXT PRIMARY KEY, body TEXT NOT NULL)`)
    }

    // 3 small rows
    for (let i = 0; i < 3; i++) {
      await pglite.query(
        `INSERT INTO small_schema.items (id, body) VALUES ($1, $2)`,
        [`s-${i}`, 'tiny']
      )
    }

    // 100 large rows to ensure we exceed the minimum page allocation
    const longBody = 'Lorem ipsum dolor sit amet. '.repeat(200)
    for (let i = 0; i < 100; i++) {
      await pglite.query(
        `INSERT INTO large_schema.items (id, body) VALUES ($1, $2)`,
        [`l-${i}`, longBody]
      )
    }

    const small = await estimateStreamStorageBytes(pglite, 'small_schema')
    const large = await estimateStreamStorageBytes(pglite, 'large_schema')

    expect(large.estimatedBytes).toBeGreaterThan(small.estimatedBytes)
    expect(large.rowCount).toBe(100)
    expect(small.rowCount).toBe(3)
  })

  it('handles multiple tables in the same schema', async () => {
    const pglite = new PGlite('memory://')
    await pglite.exec('CREATE SCHEMA IF NOT EXISTS multi')
    await pglite.exec('CREATE TABLE multi.a (id TEXT PRIMARY KEY, val TEXT)')
    await pglite.exec('CREATE TABLE multi.b (id TEXT PRIMARY KEY, val TEXT)')

    await pglite.query(`INSERT INTO multi.a (id, val) VALUES ('1', 'hello')`)
    await pglite.query(`INSERT INTO multi.b (id, val) VALUES ('1', 'world')`)

    const { estimatedBytes, rowCount } = await estimateStreamStorageBytes(pglite, 'multi')
    expect(estimatedBytes).toBeGreaterThan(0)
    expect(rowCount).toBe(2)
  })
})

describe('TributaryStream.estimateStorage', () => {
  let testServer: any

  beforeEach(() => {
    testServer = createTestServer()
  })

  it('returns storage estimate for a stream with data', async () => {
    const client = await createTestClient({ server: testServer })
    const keyPair = nacl.sign.keyPair()
    const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey))
    const stream = await client.addWriteKey('app', privateKeyBase64)

    await stream.exec('CREATE TABLE docs (id TEXT PRIMARY KEY, body TEXT NOT NULL)')
    await stream.exec("INSERT INTO docs (id, body) VALUES ('1', 'Hello world')")

    const estimate = await stream.estimateStorage()
    expect(estimate.estimatedBytes).toBeGreaterThan(0)
    expect(estimate.rowCount).toBeGreaterThanOrEqual(1)
  })
})

describe('estimateQuota', () => {
  it('returns null when navigator.storage is unavailable', async () => {
    const result = await estimateQuota()
    expect(result).toBeNull()
  })
})
