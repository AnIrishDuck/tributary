import { TributaryClient, TributaryServer } from 'tributary-client';
import { PGlite } from '@electric-sql/pglite';
import { loadKeyPair, generateKeyPair, saveKeyPair } from './key';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { info, error as errorLog } from './logger';
import * as base64url from 'urlsafe-base64';
import { getClient } from './util';

// Execute SQL command
export async function executeSQL(
  appId: string,
  streamId: string,
  sql: string,
  options: {
    localDb?: string;
    sync?: boolean;
  }
): Promise<any> {
  // GOOSE: use getClient
  // Get client using util function
  const optionsForClient = { db: options.localDb };
  const { client, db, server } = await getClient(optionsForClient);
  
  // Load the key pair from database using the client
  const keyPair = await loadKeyPair(client, streamId);
  
  // Add stream to client using the app ID
  const stream = await client.addWriteKey(appId, keyPair.secretKey);
  
  // Sync with server by default unless explicitly disabled
  const shouldSync = options.sync !== false; // Default to true
  if (shouldSync) {
    info('Syncing with server...');
    await stream.sync();
  }
  
  // Execute the SQL command if provided
  if (sql) {
    info(`Executing SQL: ${sql}`);
    const result = await stream.query(sql);
    return result;
  }
  
  // If no SQL command but sync was performed, return success
  return { message: 'Sync completed successfully' };
}
