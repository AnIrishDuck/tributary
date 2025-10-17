import { TributaryClient, TributaryServer } from 'tributary-client';
import { PGlite } from '@electric-sql/pglite';
import { loadKeyPair } from './key';
import * as path from 'path';
import * as os from 'os';
import { info } from './logger';
import { encodeBase64 } from 'tweetnacl-util';

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
  
  // Create a client instance (without privateKey and collectionId in constructor)
  const client = new TributaryClient({
    server,
    db: db // Use the local database instance
  });
  
  // Derive public key to use as stream ID
  const publicKey = keyPair.secretKey.slice(32);
  const streamId = encodeBase64(publicKey);
  // Sanitize stream ID for use as schema name (replace ALL invalid characters)
  const sanitizedStreamId = streamId.replace(/[^a-zA-Z0-9]/g, '_');
  const schemaName = `cli_${sanitizedStreamId}`;
  
  // Add stream to client (this replaces the old constructor approach)
  let stream;
  if (options.writeKey) {
    // If we have a write key, add it as a write stream
    stream = await client.addWriteKey(keyPair.secretKey, 'cli', sanitizedStreamId);
  } else {
    // If we only have a read key, register the stream for read access and get it
    console.log('DEBUG: Looking for read-only stream with ID:', sanitizedStreamId);
    try {
      // Make sure tributary schema and table exist
      await db.exec(`CREATE SCHEMA IF NOT EXISTS tributary`);
      await db.exec(
        `CREATE TABLE IF NOT EXISTS tributary.streams (
          id TEXT PRIMARY KEY,
          read_key BYTEA NOT NULL,
          write_key BYTEA,
          last_sync_index INTEGER
        )`
      );
      
      // Register this stream in the database for read access if it doesn't exist
      await db.query(
        `INSERT INTO tributary.streams (id, read_key, write_key, last_sync_index) VALUES ($1, $2, NULL, NULL) ON CONFLICT (id) DO NOTHING`,
        [sanitizedStreamId, publicKey]
      );
    } catch (error) {
      console.error('Warning: Could not register read-only stream in database:', error);
    }
    
    // Now get the stream
    stream = await client.get(sanitizedStreamId);
    if (!stream) {
      console.log('DEBUG: Could not get stream with ID:', sanitizedStreamId);
      throw new Error('Read-only operations not fully supported in this CLI version');
    }
  }
  
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
