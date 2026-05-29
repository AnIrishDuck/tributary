#!/usr/bin/env -S npx tsx

import { Command } from 'commander';
import { TributaryClient, deriveStreamSeed } from 'tributary-client';
import { createCliServer, cliLogin, cliLogout, getCliAuthToken } from 'tributary-client/cli';
import { localMigrations, createHomeLibrary } from 'scribe-data';
import { v4 as uuidv4 } from 'uuid';
import { PGlite } from '@electric-sql/pglite';
import nacl from 'tweetnacl';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import * as base64url from 'urlsafe-base64';

// Import the sync function
import { sync, syncAndIndex, computeSyncOperations } from './sync.js';

// Import the diff formatter
import { formatDiffStat } from './diff.js';

// Import extracted modules
import { syncHomeLibrary, getLibraryWriteKey, listLinkedLibraries } from './home.js';
import { resolveLibraryPk, writeStoredLibraryPk } from './libraryPk.js';

const SCRIBE_HOME_DIR = path.join(os.homedir(), '.scribe');
const HOME_DB_PATH = path.join(SCRIBE_HOME_DIR, 'home-db');
const CONFIG_APP_ID = 'scribe';

function withErrorHandling<T extends (...args: any[]) => Promise<void>>(fn: T): T {
  return (async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  }) as T;
}

/**
 * Create a TributaryClient for the home library.
 */
async function getHomeClient(): Promise<TributaryClient> {
  await fs.promises.mkdir(HOME_DB_PATH, { recursive: true });
  const pglite = new PGlite(HOME_DB_PATH);
  const server = await createCliServer();
  return new TributaryClient({ server, db: pglite as any });
}

/**
 * Create a TributaryClient and stream for a sync directory using the home library.
 * The write key is looked up from the home library's linked collections.
 */
async function createSyncClient(directory: string, libraryPk: string, dbPath?: string) {
  // Use db/ directory within the checkout if dbPath is not explicitly provided
  let pglitePath: string;
  if (dbPath) {
    pglitePath = dbPath;
  } else {
    pglitePath = path.join(directory, '.scribe', 'db');
  }

  await fs.promises.mkdir(pglitePath, { recursive: true });
  const pglite = new PGlite(pglitePath);
  const server = await createCliServer();
  const client = new TributaryClient({ server, db: pglite as any });

  // Look up the write key from the home library
  const homeClient = await getHomeClient();
  const writeKey = await getLibraryWriteKey(homeClient, libraryPk);

  if (!writeKey) {
    throw new Error(
      `Library with public key '${libraryPk}' not found in home library. ` +
      `Run \`scribe library list\` to see available libraries.`
    );
  }

  const stream = await client.addWriteKey(CONFIG_APP_ID, writeKey);
  return { client, stream };
}

const program = new Command();

program
  .name('scribe')
  .description('CLI for Tributary Scribe app')
  .version('1.0.0');

program
  .command('sync')
  .description('Synchronize notes between a local directory and a Tributary Scribe library')
  .argument('<directory>', 'Local directory to sync with')
  .option('--library-pk <public-key>', 'Public key of the library to sync (stored for future use)')
  .option('--db <path>', 'Local database directory that is synced with the server')
  .option('--dry-run', 'Show what would be synced without making changes')
  .option('-l, --limit <number>', 'Maximum number of notes to process in this run', '100')
  .action(withErrorHandling(async (directory, options) => {
    // Validate auth token before doing any work
    const authToken = await getCliAuthToken();
    if (!authToken) {
      throw new Error('Not logged in. Please run `scribe login` first.');
    }

    const libraryPk = resolveLibraryPk(directory, options.libraryPk);

    // Store the library PK for future use
    await writeStoredLibraryPk(directory, libraryPk);

    const { client, stream } = await createSyncClient(directory, libraryPk, options.db);

    // Sync FIRST to get existing data from server
    const syncStatus = await stream.sync(1000);
    console.log(`Initial sync: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`);

    // Create local tables for the existing library
    await localMigrations(stream.local());

    // Parse limit option
    const limit = parseInt(options.limit, 10);

    // Now sync the local directory with the database
    await sync(stream, client, directory, { dryRun: options.dryRun, limit });

    console.log(`Synced with directory: ${directory}`);
    if (options.dryRun) {
      console.log('Dry run completed - no changes made');
    }
  }));

program
  .command('diff')
  .description('Show what would be synced without making changes')
  .option('--stat', 'Show a summary of sync operations')
  .option('--path <directory>', 'Local directory to diff', '.')
  .option('--library-pk <public-key>', 'Public key of the library to sync (stored for future use)')
  .option('--db <path>', 'Local database directory that is synced with the server')
  .option('-l, --limit <number>', 'Maximum number of notes to process in this run', '100')
  .action(withErrorHandling(async (options) => {
    // Validate auth token before doing any work
    const authToken = await getCliAuthToken();
    if (!authToken) {
      throw new Error('Not logged in. Please run `scribe login` first.');
    }

    const directory = path.resolve(options.path);
    const libraryPk = resolveLibraryPk(directory, options.libraryPk);

    const { client, stream } = await createSyncClient(directory, libraryPk, options.db);

    // Sync with server to get latest state
    const syncStatus = await stream.sync(1000);
    console.log(`Initial sync: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`);

    // Create local tables
    await localMigrations(stream.local());

    // Parse limit option
    const limit = parseInt(options.limit, 10);

    // Phase 1: Sync and index
    await syncAndIndex(stream, directory, { dryRun: true, limit });

    // Phase 2: Compute sync operations
    const localDb = stream.local();
    const operations = await computeSyncOperations(stream, localDb, directory);

    if (operations.length === 0) {
      console.log('No changes to sync.');
      return;
    }

    // Format and display
    const pkPrefix = libraryPk.slice(0, 8);
    const lines = formatDiffStat(operations, pkPrefix);
    for (const line of lines) {
      console.log(line);
    }
  }));

program
  .command('init')
  .description('Initialize a local directory for syncing with a Tributary Scribe library')
  .argument('<directory>', 'Local directory to initialize for Scribe')
  .option('--library-pk <public-key>', 'Public key of the library to sync (stored for future use)')
  .option('--db <path>', 'Local database directory that is synced with the server')
  .option('--empty', 'Initialize database tables only, without creating a seed note')
  .action(withErrorHandling(async (directory, options) => {
    // Validate auth token before doing any work
    const authToken = await getCliAuthToken();
    if (!authToken) {
      throw new Error('Not logged in. Please run `scribe login` first.');
    }

    const libraryPk = resolveLibraryPk(directory, options.libraryPk);

    // Ensure the directory exists
    await fs.promises.mkdir(directory, { recursive: true });

    // Use db/ directory within the checkout if dbPath is not explicitly provided
    let pglitePath: string;
    if (options.db) {
      pglitePath = options.db;
    } else {
      pglitePath = path.join(directory, '.scribe', 'db');
    }

    // Create the db directory
    await fs.promises.mkdir(pglitePath, { recursive: true });

    // Store the library PK for future use
    await writeStoredLibraryPk(directory, libraryPk);

    // Create client and stream using the home library
    const { client, stream } = await createSyncClient(directory, libraryPk, options.db);

    // Sync to get existing data from server
    const syncStatus = await stream.sync(1000);
    console.log(`Initial sync: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`);

    // Create local tables for the existing library
    await localMigrations(stream.local());
    console.log('Database tables initialized');

    // Only create seed note if --empty is not specified and library is empty
    if (!options.empty) {
      // Check if library already has notes
      try {
        const result = await stream.query('SELECT COUNT(*) as count FROM block', []);
        const count = parseInt((result.rows[0] as { count: string }).count, 10);
        if (count === 0) {
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

Welcome to Scribe! This is a sample note to help you get started.

## Basic Usage

1. Edit markdown files in your sync directory
2. Use \`scribe sync\` to synchronize your changes
3. Link to other notes using [Note Title](note-title) syntax

## Markdown Features

Scribe supports standard Markdown features:

- Headers: \`# Header\`
- Lists: \`- Item\` or \`1. Item\`
- Links: \`[text](link)\`
- Tags: \`[#tag](#tag)\`

## Tags

You can tag notes using the format \`[#tagname](#tagname)\`.
For example: [#example](#example) [#getting-started](#getting-started)

## Syncing

Use \`scribe sync <directory>\` to synchronize your local directory with the Tributary library.
`
            ]
          );
          console.log('Seed "howto" note created successfully');
        } else {
          console.log(`Library already has ${count} note(s), skipping seed note`);
        }
      } catch {
        // Block table may not exist yet if library is truly new
        console.log('Skipping seed note check (library may be empty)');
      }
    } else {
      console.log('Database initialized with no seed note (empty initialization)');
    }

    console.log(`Initialized Scribe directory: ${directory}`);
    console.log(`Directory structure:`);
    console.log(`  ${directory}/`);
    console.log(`    .scribe/`);
    console.log(`      db/`);
    console.log(`      library-pk`);
    console.log(`    note-title.md`);
  }));

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.isTTY) stdin.setRawMode(true);
    let password = '';
    const onData = (ch: Buffer) => {
      const c = ch.toString('utf8');
      if (c === '\n' || c === '\r') {
        stdin.removeListener('data', onData);
        if (stdin.isTTY) stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        process.stderr.write('\n');
        resolve(password);
      } else if (c === '\u0003') {
        // Ctrl-C
        process.exit(1);
      } else if (c === '\u007f' || c === '\b') {
        password = password.slice(0, -1);
      } else {
        password += c;
      }
    };
    stdin.resume();
    stdin.on('data', onData);
  });
}

program
  .command('login')
  .description('Log in to Scribe and sync home library')
  .action(withErrorHandling(async () => {
    // Check if already authenticated
    const existing = await getCliAuthToken();
    let email: string;
    let password: string;

    if (existing) {
      console.log('Already logged in. Syncing home library...');
      // We still need email/password to derive the home stream seed.
      // If already logged in, prompt for them to derive the seed.
      email = await prompt('Email (to sync home library): ');
      password = await promptPassword('Password: ');
    } else {
      email = await prompt('Email: ');
      password = await promptPassword('Password: ');
      await cliLogin(email, password);
      console.log('Logged in successfully.');
    }

    // Derive the home stream seed and sync the home library
    const streamSeed = await deriveStreamSeed(password, email, CONFIG_APP_ID);
    const keyPair = nacl.sign.keyPair.fromSeed(streamSeed);

    const homeClient = await getHomeClient();
    const homeStream = await homeClient.addWriteKey(CONFIG_APP_ID, keyPair.secretKey);

    // Sync first to detect whether this is a new or existing home library
    const syncStatus = await homeStream.sync(1000);
    console.log(`Home library synced: ${syncStatus.currentIndex}/${syncStatus.finalIndex}`);

    if (syncStatus.finalIndex === 0) {
      // Brand new home library — create it
      await createHomeLibrary(homeClient, 'My Library', keyPair);
      console.log('Home library created.');
    } else {
      // Existing home library — just create local tables
      const streamId = base64url.encode(Buffer.from(keyPair.publicKey));
      await homeClient.setHomeStream(streamId);
      await localMigrations(homeStream.local());
      console.log('Home library is up to date.');
    }
  }));

program
  .command('logout')
  .description('Log out (removes stored credentials)')
  .action(async () => {
    await cliLogout();
    console.log('Logged out.');
  });

// Library management commands
const libraryCmd = program
  .command('library')
  .description('Library management commands');

libraryCmd
  .command('list')
  .description('List all libraries linked in your home library')
  .action(withErrorHandling(async () => {
    const homeClient = await getHomeClient();
    const linkedLibraries = await listLinkedLibraries(homeClient);

    if (!linkedLibraries) {
      console.error('No home library found. Run `scribe login` first.');
      process.exit(1);
    }

    if (linkedLibraries.length === 0) {
      console.log('No linked libraries found.');
      return;
    }

    console.log('Libraries:');
    console.log('');
    for (const lib of linkedLibraries) {
      console.log(`  ${lib.title}`);
      console.log(`    pk: ${lib.linked_stream_id}`);
      console.log('');
    }
  }));

program.parse();
