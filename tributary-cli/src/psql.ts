import { TributaryClient, TributaryServer } from 'tributary-client';
import { PGlite } from '@electric-sql/pglite';
import { loadKeyPair } from './key';
import * as path from 'path';
import * as os from 'os';

// Execute SQL command
export async function executeSQL(
  sql: string,
  options: {
    readKey?: string;
    writeKey?: string;
    localDb?: string;
    collectionId?: string;
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
  
  console.log(`Using database at: ${dbPath}`);
  
  // Create a PGlite instance
  const db = new PGlite(dbPath);
  
  // Create a client instance with the collection ID
  const client = new TributaryClient({
    server,
    privateKey: keyPair.secretKey,
    collectionId,
    db: db // Use the local database instance
  });
  
  // Execute the SQL command
  console.log(`Executing SQL: ${sql}`);
  const result = await client.query(sql);
  return result;
}
