import { TributaryClient, TributaryServer } from 'tributary-client';
import { createCliServer, getCliAuthToken } from 'tributary-client/dist/cliUtils.js';
import { PGlite } from '@electric-sql/pglite';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import type { Server } from 'tributary-client';

const DEFAULT_DB_DIR = path.join(os.homedir(), '.tributary', 'db');

export async function getClient(options: { db?: string }): Promise<{
  client: TributaryClient;
  db: PGlite;
  server: Server;
}> {
  const dbPath = options.db || DEFAULT_DB_DIR;
  await fs.mkdirp(dbPath);

  const pglite = new PGlite(dbPath);
  const server = await createCliServer();
  const client = new TributaryClient({ server, db: pglite });

  return { client, db: pglite, server };
}

/**
 * Validate that a valid auth token exists before performing operations
 * that require server communication (like sync).
 * Throws an error with a helpful message if no valid token is available.
 */
export async function validateAuthToken(): Promise<void> {
  const token = await getCliAuthToken();
  if (!token) {
    throw new Error(
      'No valid authentication token found. Please log in first with your credentials. ' +
      'Your token may have expired and could not be refreshed.'
    );
  }
}
