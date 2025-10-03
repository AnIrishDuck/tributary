import { TributaryClient, TributaryServer } from 'tributary-client';
import { PGlite } from '@electric-sql/pglite';
import { loadKeyPair } from './key';
import * as path from 'path';
import * as os from 'os';
import { info } from './logger';

// Execute SQL command
export async function executeSQL(
  sql: string,
  options: {
    readKey?: string;
    writeKey?: string;
    localDb?: string;
    collectionId?: string;
    sync?: boolean;
  }
): Promise<any> {
  // Load the appropriate keys
  let readKeyPair, writeKeyPair;
  if (options.readKey) {
    readKeyPair = await loadKeyPair(options.readKey);
  }
  if (options.writeKey) {
    writeKeyPair = await loadKeyPair(options.writeKey);
  }
  
  // Determine which key to use (write key takes precedence)
  const keyPair = writeKeyPair || readKeyPair;
  
  if (!keyPair) {
    throw new Error('Either --readkey or --writekey must be specified');
  }
  
  // Default collection ID if not provided
  const collectionId = options.collectionId || 'default';
  
  // Create server instance
  const server = new TributaryServer('http://tributary:8080');
  
  // Determine the database path
  let dbPath: string;
  if (options.localDb) {
    // Use the specified local database file
    dbPath = options.localDb;
  } else {
    // Use a default location in the user's home directory
    const homeDir = os.homedir();
    const tributaryDir = path.join(homeDir, '.tributary');
    dbPath = path.join(tributaryDir, 'local.db');
  }
  
  info(`Using database at: ${dbPath}`);
  
  // Create a PGlite instance
  const db = new PGlite(dbPath);
  
  // Create a client instance with the collection ID
  const client = new TributaryClient({
    server,
    privateKey: keyPair.secretKey,
    collectionId,
    db: db // Use the local database instance
  });
  
  // Sync with server by default unless explicitly disabled
  const shouldSync = options.sync !== false; // Default to true
  if (shouldSync) {
    info('Syncing with server...');
    await client.sync();
  }
  
  // Execute the SQL command if provided
  if (sql) {
    info(`Executing SQL: ${sql}`);
    const result = await client.query(sql);
    return result;
  }
  
  // If no SQL command but sync was performed, return success
  return { message: 'Sync completed successfully' };
}
