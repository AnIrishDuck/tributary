// Basic tests for tributary-client
import { describe, it, expect } from 'vitest';
import { TributaryClient, TributaryServer, FakeServer, createTestServer, createTestClient } from '../src/index';

describe('TributaryClient', () => {
  it('should create a TributaryClient instance', async () => {
    const testServer = createTestServer();
    const privateKey = new Uint8Array(64); // Dummy private key

    const client = await createTestClient({
      server: testServer,
      privateKey: privateKey,
      collectionId: 'test-collection'
    });

    expect(client).toBeInstanceOf(TributaryClient);
  });

  it('should create a TributaryServer instance', () => {
    const server = new TributaryServer('http://localhost:8080');
    expect(server).toBeInstanceOf(TributaryServer);
  });

  it('should create a FakeServer instance', () => {
    const fakeServer = new FakeServer();
    expect(fakeServer).toBeInstanceOf(FakeServer);
  });
});
