import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest'
import { Kysely } from 'kysely'
import { TributaryClient, FakeServer } from 'tributary-client'
import { KyselyTributary } from '../src/kysely-tributary'

// Dynamically import tweetnacl modules
let nacl: any;
let encodeBase64: any;

beforeAll(async () => {
  // Try to import tweetnacl through tributary-client's node_modules
  try {
    nacl = (await import('tributary-client/node_modules/tweetnacl')).default;
    const util = await import('tributary-client/node_modules/tweetnacl-util');
    encodeBase64 = util.encodeBase64;
  } catch (error) {
    // Fallback to direct import
    try {
      nacl = (await import('tweetnacl')).default;
      const util = await import('tweetnacl-util');
      encodeBase64 = util.encodeBase64;
    } catch (fallbackError) {
      console.error('Failed to import tweetnacl modules:', error, fallbackError);
      throw fallbackError;
    }
  }
});

// Test database interface
type TestDB = {
  groceries: {
    id: number
    name: string
  }
}

describe('kysely-tributary dialect', () => {
  let server: FakeServer
  let client: TributaryClient
  let db: Kysely<TestDB>

  beforeEach(async () => {
    // Create a fake server for testing
    server = new FakeServer()
    
    // Generate a key pair for testing
    const keyPair = nacl.sign.keyPair()
    const privateKeyBase64 = encodeBase64(keyPair.secretKey)
    
    // Create TributaryClient with the fake server
    client = new TributaryClient({
      server,
      privateKey: privateKeyBase64,
      collectionId: 'test-collection'
    })
    
    // Create Kysely with Tributary dialect
    const { dialect } = new KyselyTributary(client)
    db = new Kysely<TestDB>({ dialect })
    
    // Create test table
    await db.schema
      .createTable('groceries')
      .addColumn('id', 'serial', (cb) => cb.primaryKey())
      .addColumn('name', 'text', (cb) => cb.notNull())
      .execute()
  })

  afterEach(async () => {
    try {
      await db.schema.dropTable('groceries').execute()
    } catch (error) {
      // Ignore errors if table doesn't exist
    }
  })

  it('should execute queries', async () => {
    const items = ['bread', 'milk', 'rice']
    for (let item of items) {
      const insert1 = await db
        .insertInto('groceries')
        .values({ name: item })
        .returning(['name'])
        .execute()
      expect(insert1).toEqual([{ name: item }])
    }

    const select1 = await db.selectFrom('groceries').selectAll().execute()
    expect(select1).toEqual([
      { id: 1, name: 'bread' },
      { id: 2, name: 'milk' },
      { id: 3, name: 'rice' },
    ])

    const delete1 = await db
      .deleteFrom('groceries')
      .where('id', '=', 2)
      .returningAll()
      .execute()
    expect(delete1).toEqual([{ id: 2, name: 'milk' }])

    const update1 = await db
      .updateTable('groceries')
      .set({ name: 'white rice' })
      .where('id', '=', 3)
      .returning(['name'])
      .execute()
    expect(update1).toEqual([{ name: 'white rice' }])

    const select2 = await db
      .selectFrom('groceries')
      .select('name')
      .orderBy('id', 'desc')
      .execute()
    expect(select2).toEqual([{ name: 'white rice' }, { name: 'bread' }])
  })

  it('should perform successful transaction', async () => {
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('groceries').values({ name: 'apples' }).execute()
      await trx.insertInto('groceries').values({ name: 'bananas' }).execute()
    })

    const data = await db.selectFrom('groceries').selectAll().execute()
    expect(data.length).toBe(2)
  })
})
