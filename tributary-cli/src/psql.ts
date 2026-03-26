import { TributaryClient, TributaryServer } from 'tributary-client';
import { PGlite } from '@electric-sql/pglite';
import { loadKeyPair, generateKeyPair, saveKeyPair } from './key';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { info, error as errorLog } from './logger';
import * as base64url from 'urlsafe-base64';
import { getClient, validateAuthToken } from './util';

function isReadQuery(sql: string): boolean {
  const trimmed = sql.trim().toLowerCase();
  return trimmed.startsWith('select') || trimmed.startsWith('explain') || trimmed.startsWith('show');
}

// Execute SQL command
export async function executeSQL(
  appId: string,
  streamId: string,
  sql: string | undefined,
  options: {
    localDb?: string;
    sync?: boolean;
  }
): Promise<{ message: string } | { rows: unknown[] }> {
  const { client, db, server } = await getClient({ db: options.localDb });

  // Load the key pair from database using the client
  const keyPair = await loadKeyPair(client, appId, streamId);

  // Add stream to client using the app ID
  const stream = await client.addWriteKey(appId, keyPair.secretKey);

  // Sync with server by default unless explicitly disabled
  const shouldSync = options.sync !== false; // Default to true
  if (shouldSync) {
    await validateAuthToken();
    info('Syncing with server...');
    await stream.sync(1000);
  }

  // Execute the SQL command if provided
  if (sql) {
    info(`Executing SQL: ${sql}`);
    if (shouldSync) {
      await validateAuthToken();
    }
    const target = shouldSync ? stream : stream.local();
    if (isReadQuery(sql)) {
      return await target.query(sql);
    } else {
      await target.exec(sql);
      return { message: 'Command executed successfully' };
    }
  }

  // If no SQL command but sync was performed, return success
  return { message: 'Sync completed successfully' };
}
