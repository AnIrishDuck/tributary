// Tests for account config (server-side key/value registry)
import { describe, it, expect, beforeEach } from 'vitest';
import { TributaryClient, createTestServer } from '../src/index';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';

describe('Account Config', () => {
  let server: any;

  beforeEach(() => {
    server = createTestServer();
  });

  it('should return empty config initially', async () => {
    const config = await server.getAccountConfig();
    expect(config).toEqual([]);
  });

  it('should set and get a config entry', async () => {
    const stored = await server.setAccountConfig('theme', 'dark');
    expect(stored).toBe(true);

    const config = await server.getAccountConfig();
    expect(config).toEqual([{ key: 'theme', value: 'dark' }]);
  });

  it('should update an existing config entry', async () => {
    await server.setAccountConfig('theme', 'dark');
    await server.setAccountConfig('theme', 'light');

    const config = await server.getAccountConfig();
    expect(config).toEqual([{ key: 'theme', value: 'light' }]);
  });

  it('should store multiple config entries', async () => {
    await server.setAccountConfig('theme', 'dark');
    await server.setAccountConfig('encrypt', 'true');

    const config = await server.getAccountConfig();
    expect(config).toHaveLength(2);

    const keys = config.map((e: any) => e.key).sort();
    expect(keys).toEqual(['encrypt', 'theme']);
  });

  it('should delete a config entry', async () => {
    await server.setAccountConfig('theme', 'dark');
    await server.setAccountConfig('encrypt', 'true');

    await server.deleteAccountConfig('theme');

    const config = await server.getAccountConfig();
    expect(config).toEqual([{ key: 'encrypt', value: 'true' }]);
  });

  it('should reject keys longer than 256 characters', async () => {
    const longKey = 'a'.repeat(257);
    const stored = await server.setAccountConfig(longKey, 'value');
    expect(stored).toBe(false);
  });

  it('should reject values longer than 256 characters', async () => {
    const longValue = 'a'.repeat(257);
    const stored = await server.setAccountConfig('key', longValue);
    expect(stored).toBe(false);
  });

  it('should accept keys and values of exactly 256 characters', async () => {
    const maxKey = 'k'.repeat(256);
    const maxValue = 'v'.repeat(256);
    const stored = await server.setAccountConfig(maxKey, maxValue);
    expect(stored).toBe(true);

    const config = await server.getAccountConfig();
    expect(config).toEqual([{ key: maxKey, value: maxValue }]);
  });

  it('should enforce max 64 entries', async () => {
    // Fill up to the limit
    for (let i = 0; i < 64; i++) {
      const stored = await server.setAccountConfig(`key${i}`, `value${i}`);
      expect(stored).toBe(true);
    }

    // The 65th entry should fail
    const stored = await server.setAccountConfig('overflow', 'value');
    expect(stored).toBe(false);

    // Updating an existing key should still work
    const updated = await server.setAccountConfig('key0', 'updated');
    expect(updated).toBe(true);
  });

  it('should allow adding after deleting when at max entries', async () => {
    // Fill up to the limit
    for (let i = 0; i < 64; i++) {
      await server.setAccountConfig(`key${i}`, `value${i}`);
    }

    // Delete one entry
    await server.deleteAccountConfig('key0');

    // Now we should be able to add a new one
    const stored = await server.setAccountConfig('newkey', 'newvalue');
    expect(stored).toBe(true);
  });
});

describe('Account Config Integration', () => {
  let testServer: any;
  let keyPair: nacl.SignKeyPair;
  let privateKeyBase64: string;

  beforeEach(() => {
    testServer = createTestServer();
    keyPair = nacl.sign.keyPair();
    privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey));
  });

  it('should persist config alongside stream operations', async () => {
    const client = new TributaryClient({ server: testServer });
    const stream = await client.addWriteKey('scribe', privateKeyBase64);

    // Set up a home stream and account config in parallel
    await client.setHomeStream(stream.getId());
    await testServer.setAccountConfig('encrypt_all', 'true');
    await testServer.setAccountConfig('home_stream', stream.getId());

    // Perform normal stream operations
    await stream.exec('CREATE TABLE docs (id SERIAL PRIMARY KEY, title TEXT)');
    await stream.exec("INSERT INTO docs (title) VALUES ('secret note')");

    // Verify stream works
    const result = await stream.query('SELECT * FROM docs');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].title).toBe('secret note');

    // Verify config is available alongside stream data
    const config = await testServer.getAccountConfig();
    expect(config).toHaveLength(2);

    const configMap = Object.fromEntries(config.map((e: any) => [e.key, e.value]));
    expect(configMap['encrypt_all']).toBe('true');
    expect(configMap['home_stream']).toBe(stream.getId());
  });

  it('should allow a second client to read config and sync the stream', async () => {
    // First client sets up config and writes data
    const client1 = new TributaryClient({ server: testServer });
    const stream1 = await client1.addWriteKey('scribe', privateKeyBase64);

    await testServer.setAccountConfig('encrypt_all', 'true');
    await stream1.exec('CREATE TABLE notes (id SERIAL PRIMARY KEY, body TEXT)');
    await stream1.exec("INSERT INTO notes (body) VALUES ('hello')");

    // Second client reads config, then syncs the stream
    const client2 = new TributaryClient({ server: testServer });

    const config = await testServer.getAccountConfig();
    const configMap = Object.fromEntries(config.map((e: any) => [e.key, e.value]));
    expect(configMap['encrypt_all']).toBe('true');

    const stream2 = await client2.addWriteKey('scribe', privateKeyBase64);
    await stream2.sync(1000);

    const result = await stream2.query('SELECT * FROM notes');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].body).toBe('hello');
  });
});
