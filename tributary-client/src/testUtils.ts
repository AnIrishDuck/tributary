// Utility functions for tests
import { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { Server } from './server.js';
import { FakeServer } from './fakeServer.js';
import { TributaryServer } from './tributaryServer.js';
import { TributaryClient } from './tributaryClient.js';

/**
 * Creates a test server instance for use in tests
 * @returns Server instance (either FakeServer or TributaryServer)
 */
export function createTestServer(): Server {
  const testUrl = process.env.TRIBUTARY_TEST_URL;
  const testKey = process.env.TRIBUTARY_TEST_KEY;

  if (testUrl) {
    // Return a real TributaryServer when TRIBUTARY_TEST_URL is set
    return new TributaryServer(testUrl, testKey);
  } else {
    // Return a FakeServer by default
    return new FakeServer();
  }
}

let encryptedDbCounter = 0;

/**
 * Create a PGlite instance for tests. When TRIBUTARY_TEST_ENCRYPTED is set,
 * returns a PGlite backed by EncryptedIdbFs.
 */
export async function createTestDb(): Promise<PGliteInterface> {
  if (process.env.TRIBUTARY_TEST_ENCRYPTED) {
    // @ts-ignore -- fake-indexeddb/auto types don't resolve under package.json "exports"
    await import('fake-indexeddb/auto');
    const nacl = await import('tweetnacl');
    const { EncryptedIdbFs } = await import('./encryptedIdbFs.js');
    const key = nacl.default.randomBytes(nacl.default.secretbox.keyLength);
    const dbName = `test-encrypted-${encryptedDbCounter++}`;
    return new PGlite({
      fs: new EncryptedIdbFs(dbName, key) as any,
    });
  }
  return new PGlite();
}

/**
 * Create a TributaryClient for tests. When TRIBUTARY_TEST_ENCRYPTED is set,
 * the client's PGlite is backed by EncryptedIdbFs.
 */
export async function createTestClient(options: {
  server: Server;
  db?: PGliteInterface;
  privateKey?: string | Uint8Array;
  collectionId?: string;
}): Promise<TributaryClient> {
  const db = options.db ?? await createTestDb();
  return new TributaryClient({ ...options, db });
}
