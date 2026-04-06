/**
 * Core sync tests pulled from tributary-client.
 * These verify the fundamental sync primitives that the SyncLoop depends on.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createTestServer, createTestClient, createTestDb, FakeServer, SyncRequiredError } from 'tributary-client'
import * as base64url from 'urlsafe-base64'
import nacl from 'tweetnacl'

describe('Core Sync Functionality', () => {
  let testServer: any
  let testKeyPair: nacl.SignKeyPair
  let testPrivateKeyBase64: string

  beforeEach(() => {
    testServer = createTestServer()
    testKeyPair = nacl.sign.keyPair()
    testPrivateKeyBase64 = base64url.encode(Buffer.from(testKeyPair.secretKey))
  })

  it('should track last sync index and avoid replaying commands', async () => {
    const client = await createTestClient({ server: testServer })
    const stream = await client.addWriteKey('test', testPrivateKeyBase64)

    await stream.query("CREATE TABLE test (id INTEGER, name TEXT)")
    await stream.query("INSERT INTO test VALUES (1, 'first')")
    await stream.query("INSERT INTO test VALUES (2, 'second')")

    const initialLastSyncIndex = (stream as any).lastSyncIndex
    expect(initialLastSyncIndex).toBe(3)

    await stream.sync(10000)
    expect((stream as any).lastSyncIndex).toBe(3)

    await stream.query("INSERT INTO test VALUES (3, 'third')")
    await stream.sync(10000)
    expect((stream as any).lastSyncIndex).toBe(4)
  })

  it('should not double process data when creating a new client with existing database', async () => {
    const sharedDb = await createTestDb()
    const client1 = await createTestClient({ server: testServer, db: sharedDb })
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64)

    await stream1.query("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)")
    await stream1.query("INSERT INTO items VALUES (1, 'item1')")
    await stream1.query("INSERT INTO items VALUES (2, 'item2')")
    await stream1.sync(10000)

    let result = await stream1.query("SELECT COUNT(*) as count FROM items")
    expect(result.rows[0].count).toBe(2)

    const client2 = await createTestClient({ server: testServer, db: sharedDb })
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64)
    await stream2.sync(10000)

    result = await stream2.query("SELECT COUNT(*) as count FROM items")
    expect(result.rows[0].count).toBe(2)
  })

  it('should reject writes when partially synced with remote blobs remaining', async () => {
    const writerDb = await createTestDb()
    const readerDb = await createTestDb()

    const writerClient = await createTestClient({ server: testServer, db: writerDb })
    const readerClient = await createTestClient({ server: testServer, db: readerDb })

    const writerStream = await writerClient.addWriteKey('test', testPrivateKeyBase64)
    const readerStream = await readerClient.addWriteKey('test', testPrivateKeyBase64)

    await writerStream.query("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)")
    await writerStream.query("INSERT INTO items VALUES (1, 'a')")
    await writerStream.query("INSERT INTO items VALUES (2, 'b')")
    await writerStream.query("INSERT INTO items VALUES (3, 'c')")
    await writerStream.query("INSERT INTO items VALUES (4, 'd')")

    const partialSync = await readerStream.sync(2)
    expect(partialSync.complete()).toBe(false)

    await expect(
      readerStream.query("INSERT INTO items VALUES (100, 'from_reader')")
    ).rejects.toThrow(SyncRequiredError)

    let status
    do { status = await readerStream.sync(1000) } while (!status.complete())

    await readerStream.query("INSERT INTO items VALUES (100, 'from_reader')")
    const result = await readerStream.query("SELECT * FROM items ORDER BY id")
    expect(result.rows.length).toBe(5)
  })

  it('should return correct complete() status during batch sync', async () => {
    const freshDb1 = await createTestDb()
    const freshDb2 = await createTestDb()
    const freshClient1 = await createTestClient({ server: testServer, db: freshDb1 })
    const freshClient2 = await createTestClient({ server: testServer, db: freshDb2 })

    const stream1 = await freshClient1.addWriteKey('test', testPrivateKeyBase64)
    await stream1.query("CREATE TABLE test_table (id INTEGER)")
    await stream1.query("INSERT INTO test_table VALUES (1)")
    await stream1.query("INSERT INTO test_table VALUES (2)")

    const stream2 = await freshClient2.addWriteKey('test', testPrivateKeyBase64)

    const result1 = await stream2.sync(2)
    expect(result1.complete()).toBe(false)
    expect(result1.currentIndex).toBe(2)

    const result2 = await stream2.sync(100)
    expect(result2.complete()).toBe(true)
    expect(result2.currentIndex).toBe(3)
  })

  it('should sync data between two clients', async () => {
    const db1 = await createTestDb()
    const db2 = await createTestDb()

    const client1 = await createTestClient({ server: testServer, db: db1 })
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64)

    const client2 = await createTestClient({ server: testServer, db: db2 })
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64)

    await stream1.exec("CREATE TABLE IF NOT EXISTS sync_test (id INTEGER PRIMARY KEY, message TEXT, source TEXT)")
    await stream1.exec("INSERT INTO sync_test VALUES (1, 'Hello from DB1', 'DB1')")

    await stream2.sync(10000)
    const db2Result = await stream2.query("SELECT * FROM sync_test ORDER BY id")
    expect(db2Result.rows.some((r: any) => r.message === 'Hello from DB1')).toBe(true)

    await stream2.exec("INSERT INTO sync_test VALUES (2, 'Hello from DB2', 'DB2')")
    await stream1.sync(10000)

    const db1Result = await stream1.query("SELECT * FROM sync_test ORDER BY id")
    expect(db1Result.rows.some((r: any) => r.message === 'Hello from DB1')).toBe(true)
    expect(db1Result.rows.some((r: any) => r.message === 'Hello from DB2')).toBe(true)
  })
})

describe('Batch Sync', () => {
  let server: FakeServer
  let keyPair: nacl.SignKeyPair
  let privateKeyBase64: string

  beforeEach(() => {
    server = new FakeServer()
    keyPair = nacl.sign.keyPair()
    privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey))
  })

  it('should sync in batches and return correct in-sync status', async () => {
    const client = await createTestClient({ server })
    const stream = await client.addWriteKey('test', privateKeyBase64)

    await stream.exec('CREATE TABLE test (id INTEGER)')
    for (let i = 1; i <= 4; i++) await stream.exec(`INSERT INTO test VALUES (${i})`)

    const client2 = await createTestClient({ server })
    const stream2 = await client2.addWriteKey('test', privateKeyBase64)

    let status = await stream2.sync(2)
    expect(status.complete()).toBe(false)
    status = await stream2.sync(2)
    expect(status.complete()).toBe(false)
    status = await stream2.sync(2)
    expect(status.complete()).toBe(true)

    const result: any = await stream2.local().query('SELECT * FROM test ORDER BY id')
    expect(result.rows.length).toBe(4)
  })

  it('should not reprocess the last synced blob', async () => {
    const client = await createTestClient({ server })
    const stream = await client.addWriteKey('test', privateKeyBase64)

    await stream.exec('CREATE TABLE test (id INTEGER)')
    await stream.exec('INSERT INTO test VALUES (1)')
    await stream.exec('INSERT INTO test VALUES (2)')

    const client2 = await createTestClient({ server })
    const stream2 = await client2.addWriteKey('test', privateKeyBase64)

    await stream2.sync(2)
    let result: any = await stream2.local().query('SELECT * FROM test ORDER BY id')
    expect(result.rows.length).toBe(1)

    await stream2.sync(2)
    result = await stream2.local().query('SELECT * FROM test ORDER BY id')
    expect(result.rows.length).toBe(2)
  })
})

describe('Sync Errors', () => {
  let testServer: any
  let testKeyPair: nacl.SignKeyPair
  let testPrivateKeyBase64: string

  beforeEach(() => {
    testServer = createTestServer()
    testKeyPair = nacl.sign.keyPair()
    testPrivateKeyBase64 = base64url.encode(Buffer.from(testKeyPair.secretKey))
  })

  it('should record a parse error when a blob cannot be decrypted', async () => {
    const db1 = await createTestDb()
    const client1 = await createTestClient({ server: testServer, db: db1 })
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64)

    await stream1.query("CREATE TABLE test (id INTEGER)")
    await stream1.query("INSERT INTO test VALUES (1)")

    const pubkey = stream1.getPublicKeyBase64()
    const allBlobs = Array.from(testServer.blobs.values()) as any[]
    const targetBlob = allBlobs.find((b: any) => b.pubkey === pubkey && b.sequenceNumber === 2)
    targetBlob.data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])

    const db2 = await createTestDb()
    const client2 = await createTestClient({ server: testServer, db: db2 })
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64)

    await stream2.sync(10000)
    const errors = await stream2.getErrors()
    expect(errors.length).toBeGreaterThanOrEqual(1)

    const parseError = errors.find((e: any) => e.error_type === 'parse_error')
    expect(parseError).toBeDefined()
    expect(parseError!.blob_sequence).toBe(2)
  })

  it('should not record errors when sync succeeds normally', async () => {
    const db1 = await createTestDb()
    const client1 = await createTestClient({ server: testServer, db: db1 })
    const stream1 = await client1.addWriteKey('test', testPrivateKeyBase64)

    await stream1.query("CREATE TABLE test (id INTEGER)")
    await stream1.query("INSERT INTO test VALUES (1)")

    const db2 = await createTestDb()
    const client2 = await createTestClient({ server: testServer, db: db2 })
    const stream2 = await client2.addWriteKey('test', testPrivateKeyBase64)
    await stream2.sync(10000)

    const errors = await stream2.getErrors()
    expect(errors.length).toBe(0)

    const result = await stream2.query("SELECT * FROM test")
    expect(result.rows.length).toBe(1)
  })
})
