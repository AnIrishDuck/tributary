// Utility functions for tests
import { PGlite, PGliteInterface } from '@electric-sql/pglite';
import { Server, BlobMetadata, BlobData, ArrowBlob } from './server.js';
import { FakeServer } from './fakeServer.js';
import { TributaryServer } from './tributaryServer.js';
import { TributaryClient } from './tributaryClient.js';
import { info } from './logger.js';

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
    info(`Creating encrypted PGlite database: ${dbName}`);
    return new PGlite({
      fs: new EncryptedIdbFs(dbName, key) as any,
    });
  }
  return new PGlite();
}

export class TestFakeServer extends FakeServer {
  private _disconnected = false
  private maxBlobsPerSync: Map<string, number> = new Map()

  disconnect(): void {
    this._disconnected = true
  }

  reconnect(): void {
    this._disconnected = false
  }

  setMaxBlobsPerSync(pubkey: string, max: number): void {
    this.maxBlobsPerSync.set(pubkey, max)
  }

  clearMaxBlobsPerSync(pubkey: string): void {
    this.maxBlobsPerSync.delete(pubkey)
  }

  clearAllMaxBlobsPerSync(): void {
    this.maxBlobsPerSync.clear()
  }

  isDisconnected(): boolean {
    return this._disconnected
  }

  async storeBlob(
    pubkey: string,
    data: Uint8Array,
    hash: string,
    priorHash: string,
    signature: string,
    sequenceNumber: number
  ): Promise<boolean> {
    if (this._disconnected) {
      throw new Error('Network error: Server disconnected')
    }
    return super.storeBlob(pubkey, data, hash, priorHash, signature, sequenceNumber)
  }

  async retrieveBlob(
    pubkey: string,
    id: string
  ): Promise<BlobData | null> {
    if (this._disconnected) {
      throw new Error('Network error: Server disconnected')
    }
    return super.retrieveBlob(pubkey, id)
  }

  async getLatestBlobMetadata(
    pubkey: string
  ): Promise<BlobMetadata | null> {
    if (this._disconnected) {
      throw new Error('Network error: Server disconnected')
    }
    return super.getLatestBlobMetadata(pubkey)
  }

  async getBlobsArrow(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{
    blobs: ArrowBlob[]
    totalCount: number
  }> {
    if (this._disconnected) {
      throw new Error('Network error: Server disconnected')
    }
    return super.getBlobsArrow(pubkey, startSequence, max)
  }

  async getAllBlobMetadata(
    pubkey: string,
    startSequence?: number,
    max?: number
  ): Promise<{
    blobs: BlobMetadata[]
    totalCount: number
  }> {
    if (this._disconnected) {
      throw new Error('Network error: Server disconnected')
    }

    const result = await super.getAllBlobMetadata(pubkey, startSequence, max)

    const maxForPubkey = this.maxBlobsPerSync.get(pubkey)
    if (maxForPubkey !== undefined && maxForPubkey > 0) {
      const limitedBlobs = result.blobs.slice(0, maxForPubkey)
      return {
        blobs: limitedBlobs,
        totalCount: result.totalCount
      }
    }

    return result
  }
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
