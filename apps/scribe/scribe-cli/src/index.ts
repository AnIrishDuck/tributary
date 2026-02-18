#!/usr/bin/env -S npx tsx

import { Command } from 'commander';
import { TributaryClient, createCliServer } from 'tributary-client';
import { indexSlugs, ensureMigrations } from '@tributary/scribe-data';
import { v4 as uuidv4 } from 'uuid';
import { PGlite } from '@electric-sql/pglite';
import nacl from 'tweetnacl';
import fs from 'fs';
import path from 'path';

// Import the sync function
import { sync } from './sync.js';

/**
 * Generate a new key pair for testing
 */
function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  return nacl.sign.keyPair();
}

/**
 * Create a TributaryClient and stream for the given directory and keys
 */
async function createClient(directory: string, readKeyPath?: string, writeKeyPath?: string, dbPath?: string) {
  // Read keys from files
  let readKeyBase64: string | undefined;
  let writeKeyBase64: string | undefined;
  
  if (readKeyPath) {
    readKeyBase64 = fs.readFileSync(readKeyPath, 'utf8').trim();
  }
  
  if (writeKeyPath) {
    writeKeyBase64 = fs.readFileSync(writeKeyPath, 'utf8').trim();
  }
  
  // Use db/ directory within the checkout if dbPath is not explicitly provided
  let pglitePath: string;
  if (dbPath) {
    pglitePath = dbPath;
  } else {
    // Use db/ directory within the checkout directory
    pglitePath = path.join(directory, 'db');
  }
  
  // Ensure the database directory exists
  await fs.promises.mkdir(pglitePath, { recursive: true });
  
  // Create PGlite instance with persistent storage
  const pglite = new PGlite(pglitePath);
  
  // Create server instance using TRIBUTARY_CLI_URL environment variable
  const server = createCliServer();
  
  // Create TributaryClient
  const client = new TributaryClient({
    server,
    db: pglite as any  // Type cast to avoid PGlite version mismatch
  });
  
  // Determine which key to use
  let privateKeyArray: Uint8Array;
  
  if (writeKeyBase64) {
    privateKeyArray = Uint8Array.from(Buffer.from(writeKeyBase64, 'base64'));
  } else if (readKeyBase64) {
    privateKeyArray = Uint8Array.from(Buffer.from(readKeyBase64, 'base64'));
  } else {
    // Generate a temporary key pair for local operations only
    const keyPair = generateKeyPair();
    privateKeyArray = keyPair.secretKey;
  }
  
  // Add the write key to get or create the stream
  const stream = await client.addWriteKey('scribe', privateKeyArray);
  
  return { client, stream };
}

const program = new Command();

program
  .name('scribe')
  .description('CLI for Tributary Scribe app')
  .version('1.0.0');

program
  .command('sync')
  .description('Synchronize documents between a local directory and a Tributary Scribe collection')
  .argument('<directory>', 'Local directory to sync with')
  .option('--read-key <file>', 'File containing the read key for the collection')
  .option('--write-key <file>', 'File containing the write key for the collection')
  .option('--db <path>', 'Local database directory that is synced with the server')
  .option('--dry-run', 'Show what would be synced without making changes')
  .option('-l, --limit <number>', 'Maximum number of blocks to process in this run', '100')
  .action(async (directory, options) => {
    try {
      // Create client and stream
      const { client, stream } = await createClient(directory, options.readKey, options.writeKey, options.db);
      
      // Sync FIRST to get existing data from server
      const syncStatus = await stream.sync(1000);
      console.log(`Initial sync: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`);
      
      // Ensure migrations are run (creates local tables only for existing streams)
      await ensureMigrations(stream, true);
      
      // Parse limit option
      const limit = parseInt(options.limit);
      
      // Now sync the local directory with the database
      await sync(stream, client, directory, { dryRun: options.dryRun, limit });
      
      console.log(`Synced with directory: ${directory}`);
      if (options.dryRun) {
        console.log('Dry run completed - no changes made');
      }
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('init')
  .description('Initialize the database with required tables and a seed "howto" block')
  .argument('<directory>', 'Local directory to initialize for Scribe')
  .option('--write-key <file>', 'File containing the write key for the collection (required for creating the seed document)')
  .option('--db <path>', 'Local database directory that is synced with the server')
  .option('--empty', 'Initialize database tables only, without creating a seed document')
  .action(async (directory, options) => {
    try {
      // Ensure the directory exists
      await fs.promises.mkdir(directory, { recursive: true });
      
      // Use db/ directory within the checkout if dbPath is not explicitly provided
      let pglitePath: string;
      if (options.db) {
        pglitePath = options.db;
      } else {
        // Use db/ directory within the checkout directory
        pglitePath = path.join(directory, 'db');
      }
      
      // Create the db directory
      await fs.promises.mkdir(pglitePath, { recursive: true });
      
      // Create the slugs directory
      const slugsDir = path.join(directory, 'slugs');
      await fs.promises.mkdir(slugsDir, { recursive: true });
      
      // Create the indexed directory and its subdirectories
      const indexedDir = path.join(directory, 'indexed');
      await fs.promises.mkdir(indexedDir, { recursive: true });
      
      const tagsDir = path.join(indexedDir, 'tags');
      await fs.promises.mkdir(tagsDir, { recursive: true });
      
      const linksDir = path.join(indexedDir, 'links');
      await fs.promises.mkdir(linksDir, { recursive: true });
      
      // Create the READ-ONLY warning file
      const readOnlyContent = `# READ-ONLY

Files and directories in this directory are managed automatically by Scribe.
They will be overwritten or removed during sync operations.
Do not manually edit or add files here.
`;
      await fs.promises.writeFile(path.join(indexedDir, 'READ-ONLY.md'), readOnlyContent);
      
      // Create client and stream
      const { client, stream } = await createClient(directory, undefined, options.writeKey, options.db);
      
      // Ensure migrations are run for a NEW stream (creates stream + local tables)
      await ensureMigrations(stream, true);
      console.log('Database tables initialized');
      
      // Only create seed document if --empty is not specified
      if (!options.empty) {
        // Insert a seed "howto" block
        const now = new Date();
        await stream.exec(
          `INSERT INTO block (block_uuid, block_type, version_uuid, prior_version_uuid, insert_datetime, inserter, body) 
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            uuidv4(),
            'scribe/markdown',
            uuidv4(),
            null,
            now.toISOString(),
            'scribe-cli',
            `# Scribe Howto

Welcome to Scribe! This is a sample document to help you get started.

## Basic Usage

1. Edit documents in the \`slugs/\` directory
2. Use \`scribe sync\` to synchronize your changes
3. Link to other documents using [Document Title](document-title) syntax

## Markdown Features

Scribe supports standard Markdown features:

- Headers: \`# Header\`
- Lists: \`- Item\` or \`1. Item\`
- Links: \`[text](link)\`
- Tags: \`[#tag](#tag)\`

## Tags

You can tag documents using the format \`[#tagname](#tagname)\`. 
For example: [#example](#example) [#getting-started](#getting-started)

## Syncing

Use \`scribe sync <directory>\` to synchronize your local directory with the Tributary collection.
`
          ]
        );
        console.log('Seed "howto" document created successfully');
      } else {
        console.log('Database initialized with no seed document (empty initialization)');
      }
      
      console.log(`Initialized Scribe directory: ${directory}`);
      console.log(`Directory structure:`);
      console.log(`  ${directory}/`);
      console.log(`    db/`);
      console.log(`    slugs/`);
      console.log(`    indexed/`);
      console.log(`      READ-ONLY.md`);
      console.log(`      tags/`);
      console.log(`      links/`);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
