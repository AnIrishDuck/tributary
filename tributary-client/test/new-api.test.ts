// Basic tests for the new tributary-client multi-stream API
import { describe, it, expect, beforeEach } from 'vitest';
import { TributaryClient, TributaryServer, FakeServer } from '../src/index';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';

describe('TributaryClient - Multi-stream API', () => {
  let fakeServer: FakeServer;
  let privateKeyBase64: string;
  let publicKeyBase64: string;

  beforeEach(() => {
    fakeServer = new FakeServer();
    const keyPair = nacl.sign.keyPair();
    privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey));
    publicKeyBase64 = base64url.encode(Buffer.from(keyPair.publicKey));
  });

  it('should create a TributaryClient instance', () => {
    const client = new TributaryClient({
      server: fakeServer
    });
    
    expect(client).toBeInstanceOf(TributaryClient);
  });

  it('should add a write key and create a stream', async () => {
    const client = new TributaryClient({
      server: fakeServer
    });
    
    const stream = await client.addWriteKey('scribe', privateKeyBase64);
    
    expect(stream).toBeDefined();
    expect(stream.getId()).toBe(publicKeyBase64);
  });

  it('should list streams', async () => {
    const client = new TributaryClient({
      server: fakeServer
    });
    
    // Initially no streams
    let streams = await client.list();
    expect(streams).toHaveLength(0);
    
    // Add a stream
    await client.addWriteKey('scribe', privateKeyBase64);
    
    // Now we should have one stream
    streams = await client.list();
    expect(streams).toHaveLength(1);
    expect(streams[0]).toBe(publicKeyBase64);
  });

  it('should get a stream by ID', async () => {
    const client = new TributaryClient({
      server: fakeServer
    });
    
    // Add a stream
    const stream = await client.addWriteKey('scribe', privateKeyBase64);
    
    // Get the stream by ID
    const retrievedStream = await client.get(publicKeyBase64);
    expect(retrievedStream).toBeDefined();
  });

  it('should perform database operations on a stream', async () => {
    const client = new TributaryClient({
      server: fakeServer
    });
    
    const stream = await client.addWriteKey('scribe', privateKeyBase64);
    
    // Create a table
    await stream.exec('CREATE TABLE IF NOT EXISTS documents (id SERIAL PRIMARY KEY, title TEXT, content TEXT)');
    
    // Insert a document
    await stream.exec('INSERT INTO documents (title, content) VALUES ($1, $2)', ['Hello World', 'This is a test document']);
    
    // Query documents
    const result = await stream.query('SELECT * FROM documents');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].title).toBe('Hello World');
    expect(result.rows[0].content).toBe('This is a test document');
  });
});
