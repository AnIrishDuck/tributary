#!/usr/bin/env node

import { Command } from 'commander';
import { generateKeyPair, saveKeyPair, listKeys, showKey, exportKey, importKey, loadKeyPair } from './key';
import { executeSQL } from './psql';
import { info, error as errorLog, formatError } from './logger';
import { getClient } from './util';

function parseAppStreamId(appStreamId: string): [string, string] {
  const parts = appStreamId.split('/');
  if (parts.length !== 2) {
    errorLog('Error: Invalid format. Use app-id/stream-id');
    process.exit(1);
  }
  return [parts[0], parts[1]];
}

const program = new Command();

program
  .name('tributary')
  .description('CLI for Tributary operations')
  .version('1.0.0')
  .option('-d, --db <path>', 'Database directory path (default: ~/.tributary/db)');

// Create key management command with subcommands
const keyCmd = program
  .command('key')
  .description('Key management commands');

keyCmd
  .command('generate')
  .description('Generate a new key pair')
  .argument('<app-id>', 'Application identifier')
  .option('--quiet', 'Suppress output except for the stream ID')
  .action(async (appId: string, options: { quiet?: boolean }) => {
    try {
      info(`Generating new key pair for app: ${appId}`);
      const keyPair = generateKeyPair();
      
      // Get database path from global options or use default
      const globalOptions = program.opts();
      const { client } = await getClient(globalOptions);

      // Save the key pair to database using the actual stream ID
      const streamId = await saveKeyPair(client, appId, keyPair);
      
      if (!options.quiet) {
        info(`Key pair generated and saved successfully for app '${appId}' with stream ID '${streamId}'.`);
        info(`Stream ID: ${streamId}`);
      } else {
        console.log(streamId);
      }
    } catch (err) {
      errorLog('Error:', formatError(err));
      process.exit(1);
    }
  });

keyCmd
  .command('list')
  .description('List all available keys for an app')
  .argument('<app-id>', 'Application identifier')
  .action(async (appId: string) => {
    try {
      // Get database path from global options or use default
      const options = program.opts();
      const { client } = await getClient(options);

      info(`Available keys for app '${appId}':`);
      const keys = await listKeys(client);
      if (keys.length === 0) {
        info('  No keys found.');
      } else {
        // Filter keys that belong to this app
        const appKeys = [];
        for (const key of keys) {
          // Try to get the stream for this key and check if it belongs to the app
          try {
            const stream = await client.get(appId, key);
            if (stream !== undefined) {
              appKeys.push(key);
            }
          } catch (e) {
            // Ignore errors and continue
          }
        }
        
        if (appKeys.length === 0) {
          info('  No keys found for this app.');
        } else {
          appKeys.forEach(key => info(`  ${key}`));
        }
      }
    } catch (err) {
      errorLog('Error:', formatError(err));
      process.exit(1);
    }
  });

keyCmd
  .command('show')
  .description('Show details of a specific key')
  .argument('<app-stream-id>', 'App identifier and stream identifier separated by slash (app-id/stream-id)')
  .action(async (appStreamId: string) => {
    try {
      const [appId, streamId] = parseAppStreamId(appStreamId);

      // Get database path from global options or use default
      const options = program.opts();
      const { client } = await getClient(options);

      const keyDetails = await showKey(client, appId, streamId);
      info(`Key: ${streamId}`);
      info(`Public Key: ${keyDetails.publicKey}`);
    } catch (err) {
      errorLog('Error:', formatError(err));
      process.exit(1);
    }
  });

keyCmd
  .command('export')
  .description('Export a key as base64 encoded string')
  .argument('<app-stream-id>', 'App identifier and stream identifier separated by slash (app-id/stream-id)')
  .action(async (appStreamId: string) => {
    try {
      const [appId, streamId] = parseAppStreamId(appStreamId);

      // Get database path from global options or use default
      const options = program.opts();
      const { client } = await getClient(options);

      const base64Key = await exportKey(client, appId, streamId);
      // Print to stdout for piping
      console.log(base64Key);
    } catch (err) {
      errorLog('Error:', formatError(err));
      process.exit(1);
    }
  });

keyCmd
  .command('import')
  .description('Import a key from base64 encoded string via stdin')
  .argument('<app-id>', 'Application identifier')
  .action(async (appId: string) => {
    try {
      // Get database path from global options or use default
      const options = program.opts();
      const { client } = await getClient(options);

      // Read base64 key from stdin
      let base64Key = '';
      if (process.stdin.isTTY) {
        errorLog('Error: Please pipe the base64 encoded key to stdin');
        process.exit(1);
      }
      
      process.stdin.setEncoding('utf8');
      process.stdin.on('readable', () => {
        let chunk;
        while ((chunk = process.stdin.read()) !== null) {
          base64Key += chunk;
        }
      });
      
      process.stdin.on('end', async () => {
        try {
          base64Key = base64Key.trim();
          const streamId = await importKey(client, appId, base64Key);
          info(`Key imported successfully for app '${appId}' with stream ID '${streamId}'.`);
        } catch (err) {
          errorLog('Error:', formatError(err));
          process.exit(1);
        }
      });
    } catch (err) {
      errorLog('Error:', formatError(err));
      process.exit(1);
    }
  });

program
  .command('psql')
  .description('Execute SQL commands on Tributary collections')
  .argument('<app-stream-id>', 'App identifier and stream identifier separated by slash (app-id/stream-id)')
  .argument('[sql]', 'SQL command to execute')
  .option('-d, --db <path>', 'Local database file path for persistence')
  .option('-n, --no-sync', 'Disable automatic sync with server before executing command')
  .action(async (appStreamId: string, sql: string | undefined, options: { db?: string; sync: boolean }) => {
    try {
      const [appId, streamId] = parseAppStreamId(appStreamId);
      
      const result = await executeSQL(appId, streamId, sql || '', {
        localDb: options.db,
        sync: options.sync // Commander.js sets this to false when --no-sync is used
      });
      info('Result:', result);
    } catch (err) {
      errorLog('Error:', formatError(err));
      process.exit(1);
    }
  });

program.parse();
