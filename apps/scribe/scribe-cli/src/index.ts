#!/usr/bin/env node

import { Command } from 'commander';
import { Kysely } from 'kysely';
import { KyselyTributary } from 'kysely-tributary';
import { TributaryClient, TributaryServer } from 'tributary-client';
import { indexSlugs } from '@tributary/scribe-data';
import { up } from '@tributary/scribe-data/dist/migrations.js';
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
 * Create a database connection using Tributary with a real server
 */
async function createDB(directory: string, readKeyPath?: string, writeKeyPath?: string, dbPath?: string) {
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
  let pglitePath: string | undefined;
  if (dbPath) {
    pglitePath = dbPath;
  } else {
    // Use db/ directory within the checkout directory
    pglitePath = path.join(directory, 'db');
  }
  
  // Ensure the database directory exists
  if (pglitePath) {
    await fs.promises.mkdir(pglitePath, { recursive: true });
  }
  
  // Create PGlite instance with optional persistent storage
  const pglite = pglitePath ? new PGlite(pglitePath) : new PGlite();
  
  // Create TributaryClient with proper server interface
  // For now we'll use a write key if available, otherwise a read key
  let privateKeyArray: Uint8Array | undefined;
  
  if (writeKeyBase64) {
    privateKeyArray = Uint8Array.from(Buffer.from(writeKeyBase64, 'base64'));
  } else if (readKeyBase64) {
    privateKeyArray = Uint8Array.from(Buffer.from(readKeyBase64, 'base64'));
  } else {
    // Generate a temporary key pair for local operations only
    const keyPair = generateKeyPair();
    privateKeyArray = keyPair.secretKey;
  }
  
  // Create server instance pointing to the local tributary server
  const server = new TributaryServer('http://tributary:8080');
  
  // Use a unique collection ID for testing to avoid conflicts with existing data
  const collectionId = `scribe-test-${Date.now()}`;
  
  const client = new TributaryClient({
    server,
    privateKey: privateKeyArray,
    collectionId: collectionId,
    db: pglite
  });
  
  // Create Kysely instance with Tributary dialect
  const { dialect } = new KyselyTributary(client);
  const db = new Kysely<any>({ dialect });
  
  return { db, client };
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
      // Create database connection
      const { db, client } = await createDB(directory, options.readKey, options.writeKey, options.db);
      
      // Run migrations to ensure tables exist
      try {
        await up(db);
      } catch (error: any) {
        // Ignore "already exists" errors as tables may already exist from previous syncs
        if (!error.message.includes('already exists')) {
          console.error('Error creating tables:', error);
          throw error;
        }
        // If tables already exist, that's fine - continue
      }
      
      // Parse limit option
      const limit = parseInt(options.limit);
      
      // Now sync the local directory with the database
      await sync(db, client, directory, { dryRun: options.dryRun, limit });
      
      console.log(`Synced with directory: ${directory}`);
      if (options.dryRun) {
        console.log('Dry run completed - no changes made');
      }
      
      await db.destroy();
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
      
      // Create database connection (only need write key for init)
      const { db, client } = await createDB(directory, undefined, options.writeKey, options.db);
      
      // Run migrations to create tables
      try {
        await up(db);
        console.log('Database tables created successfully');
      } catch (error: any) {
        // Ignore "already exists" errors as tables may already exist from previous syncs
        if (!error.message.includes('already exists')) {
          console.error('Error creating tables:', error);
          throw error;
        }
        // If tables already exist, that's fine - continue
        console.log('Database tables already exist');
      }
      
      // Only create seed document if --empty is not specified
      if (!options.empty) {
        // Insert a seed "howto" block
        const now = new Date();
        const howtoBlock = {
          block_uuid: uuidv4(),
          block_type: 'scribe/markdown',
          version_uuid: uuidv4(),
          prior_version_uuid: null,
          insert_datetime: now.toISOString(),
          inserter: 'scribe-cli',
          body: `# Scribe Howto

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
        };
        
        await db.insertInto('block').values(howtoBlock).execute();
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
      
      await db.destroy();
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
