// Tests for account config (server-side key/value registry)
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestServer } from '../src/index';

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
