import { describe, it, expect, beforeEach } from 'vitest';
import {
  TributaryClient,
  createTestServer,
  createTestClient,
  migrate,
  hasMigration,
} from '../src/index';
import type { Migration, MigratableDb } from '../src/index';
import nacl from 'tweetnacl';
import * as base64url from 'urlsafe-base64';

/** Helper: set up a client + stream + local for each test. */
async function setup() {
  const server = createTestServer();
  const client = await createTestClient({ server });
  const keyPair = nacl.sign.keyPair();
  const privateKeyBase64 = base64url.encode(Buffer.from(keyPair.secretKey));
  const stream = await client.addWriteKey('test', privateKeyBase64);
  const local = stream.local();
  return { client, stream, local };
}

// ---------------------------------------------------------------------------
// Sample migrations used across tests
// ---------------------------------------------------------------------------

function makeMigration(name: string, tableName: string): Migration {
  return {
    name,
    up: async (db: MigratableDb) => {
      await db.exec(`CREATE TABLE IF NOT EXISTS "${tableName}" (id INTEGER PRIMARY KEY, value TEXT)`);
    },
    down: async (db: MigratableDb) => {
      await db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
    },
  };
}

const migrationA = makeMigration('001_create_alpha', 'alpha');
const migrationB = makeMigration('002_create_beta', 'beta');
const migrationC = makeMigration('003_create_gamma', 'gamma');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Migration system', () => {
  describe('TributaryLocal', () => {
    let local: any;

    beforeEach(async () => {
      const ctx = await setup();
      local = ctx.local;
    });

    it('applies migrations and tracks them in local_migrations by default', async () => {
      await migrate(local, [migrationA, migrationB]);

      // Tables should exist
      const r1 = await local.query('SELECT * FROM alpha');
      expect(r1.rows).toHaveLength(0);
      const r2 = await local.query('SELECT * FROM beta');
      expect(r2.rows).toHaveLength(0);

      // Tracking rows should exist in the default table
      const tracked = await local.query(
        'SELECT name FROM local_migrations ORDER BY name',
      );
      expect(tracked.rows).toEqual([
        { name: '001_create_alpha' },
        { name: '002_create_beta' },
      ]);
    });

    it('only applies migrations that have not been run already', async () => {
      // First run: apply A and B
      await migrate(local, [migrationA, migrationB]);

      // Insert data into alpha to prove it isn't recreated
      await local.exec("INSERT INTO alpha (id, value) VALUES (1, 'keep')");

      // Second run: A, B, C — only C should be new
      await migrate(local, [migrationA, migrationB, migrationC]);

      // alpha data preserved (migration was skipped)
      const r = await local.query('SELECT value FROM alpha WHERE id = 1');
      expect(r.rows[0].value).toBe('keep');

      // gamma table now exists
      const r2 = await local.query('SELECT * FROM gamma');
      expect(r2.rows).toHaveLength(0);

      // All three tracked
      const tracked = await local.query(
        'SELECT name FROM local_migrations ORDER BY name',
      );
      expect(tracked.rows).toHaveLength(3);
    });

    it('"before" stops at the named migration', async () => {
      await migrate(local, [migrationA, migrationB, migrationC], {
        before: '003_create_gamma',
      });

      expect(await hasMigration(local, '001_create_alpha')).toBe(true);
      expect(await hasMigration(local, '002_create_beta')).toBe(true);
      expect(await hasMigration(local, '003_create_gamma')).toBe(false);
    });

    it('"before" throws when migration name not found', async () => {
      await expect(
        migrate(local, [migrationA], { before: 'nonexistent' }),
      ).rejects.toThrow('Migration "nonexistent" not found in migration list');
    });

    it('hasMigration returns true for applied migration', async () => {
      await migrate(local, [migrationA]);
      expect(await hasMigration(local, '001_create_alpha')).toBe(true);
    });

    it('hasMigration returns false for unapplied migration', async () => {
      await migrate(local, [migrationA]);
      expect(await hasMigration(local, '002_create_beta')).toBe(false);
    });

    it('hasMigration returns false when tracking table does not exist', async () => {
      // Fresh db, no migrate() call — table doesn't exist
      const result = await hasMigration(local, 'anything');
      expect(result).toBe(false);
    });

    it('works on a database with existing tables but no migration table (pre-migrations state)', async () => {
      // Simulate cowboy migrations: create tables directly
      await local.exec('CREATE TABLE alpha (id INTEGER PRIMARY KEY, value TEXT)');
      await local.exec("INSERT INTO alpha (id, value) VALUES (42, 'existing')");

      // Now run formal migrations (idempotent CREATE IF NOT EXISTS)
      await migrate(local, [migrationA, migrationB]);

      // Existing data preserved
      const r = await local.query('SELECT value FROM alpha WHERE id = 42');
      expect(r.rows[0].value).toBe('existing');

      // Both migrations tracked
      expect(await hasMigration(local, '001_create_alpha')).toBe(true);
      expect(await hasMigration(local, '002_create_beta')).toBe(true);
    });

    it('custom tableName option works', async () => {
      await migrate(local, [migrationA], { tableName: 'my_custom_migrations' });

      const tracked = await local.query('SELECT name FROM my_custom_migrations');
      expect(tracked.rows).toHaveLength(1);
      expect(tracked.rows[0].name).toBe('001_create_alpha');
    });

    it('records blob_index as null for local migrations', async () => {
      await migrate(local, [migrationA, migrationB]);

      const tracked = await local.query(
        'SELECT name, blob_index FROM local_migrations ORDER BY name',
      );
      expect(tracked.rows).toEqual([
        { name: '001_create_alpha', blob_index: null },
        { name: '002_create_beta', blob_index: null },
      ]);
    });
  });

  describe('TributaryStream', () => {
    let stream: any;

    beforeEach(async () => {
      const ctx = await setup();
      stream = ctx.stream;
    });

    it('applies migrations and tracks them in migrations by default', async () => {
      await migrate(stream, [migrationA, migrationB]);

      const r = await stream.query('SELECT * FROM alpha');
      expect(r.rows).toHaveLength(0);

      const tracked = await stream.query('SELECT name FROM migrations ORDER BY name');
      expect(tracked.rows).toEqual([
        { name: '001_create_alpha' },
        { name: '002_create_beta' },
      ]);
    });

    it('only applies unapplied migrations', async () => {
      await migrate(stream, [migrationA, migrationB]);
      await stream.exec("INSERT INTO alpha (id, value) VALUES (1, 'keep')");

      await migrate(stream, [migrationA, migrationB, migrationC]);

      const r = await stream.query('SELECT value FROM alpha WHERE id = 1');
      expect(r.rows[0].value).toBe('keep');

      const tracked = await stream.query('SELECT name FROM migrations ORDER BY name');
      expect(tracked.rows).toHaveLength(3);
    });

    it('hasMigration works without tracking table', async () => {
      expect(await hasMigration(stream, 'anything')).toBe(false);
    });

    it('records blob_index for synced migrations', async () => {
      await migrate(stream, [migrationA, migrationB]);

      const tracked = await stream.query(
        'SELECT name, blob_index FROM migrations ORDER BY name',
      );
      // Each migration's up() produces a blob, so blob_index should be a positive integer
      for (const row of tracked.rows) {
        expect(row.blob_index).toBeTypeOf('number');
        expect(row.blob_index).toBeGreaterThan(0);
      }
      // Second migration should have a higher blob_index than the first
      expect(tracked.rows[1].blob_index).toBeGreaterThan(tracked.rows[0].blob_index);
    });
  });
});
