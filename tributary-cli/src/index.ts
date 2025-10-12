#!/usr/bin/env node

import { Command } from 'commander';
import { generateKeyPair, saveKeyPair, listKeys, showKey } from './key';
import { executeSQL } from './psql';
import { uploadStaticSite, listStaticSite, catStaticSiteFile } from './static';
import { logger, info, error as errorLog, warn } from './logger';

// Comprehensive test function
import { TributaryClient, FakeServer } from 'tributary-client';
import { loadKeyPair } from './key';
import { PGlite } from '@electric-sql/pglite';

async function comprehensivePsqlTest() {
  info('Running comprehensive psql command test...');
  
  try {
    // Load our existing test key
    const keyPair = await loadKeyPair('test-key');
    info('Loaded existing test key');
    
    // Create a FakeServer instance for testing
    const fakeServer = new FakeServer();
    info('Created FakeServer instance');
    
    // Create a local database instance
    const db = new PGlite();
    info('Created local PGlite database');
    
    // Create a client instance
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: keyPair.secretKey,
      collectionId: 'comprehensive-test-collection',
      db: db
    });
    info('Created TributaryClient instance');
    
    // Test a series of SQL operations
    info('\n--- Testing CREATE TABLE ---');
    await client.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    info('Created notes table');
    
    info('\n--- Testing INSERT operations ---');
    await client.exec(
      "INSERT INTO notes (title, content) VALUES ('First Note', 'This is the content of the first note')",
    );
    info('Inserted first note');
    
    await client.exec(
      "INSERT INTO notes (title, content) VALUES ('Second Note', 'This is the content of the second note')",
    );
    info('Inserted second note');
    
    info('\n--- Testing SELECT query ---');
    const selectResult = await client.query('SELECT * FROM notes ORDER BY id');
    info('Selected notes:', selectResult.rows);
    
    info('\n--- Testing UPDATE operation ---');
    await client.exec("UPDATE notes SET content = 'Updated content' WHERE title = 'First Note'");
    info('Updated first note');
    
    info('\n--- Testing SELECT after UPDATE ---');
    const updatedResult = await client.query('SELECT * FROM notes WHERE title = \'First Note\'');
    info('Updated note:', updatedResult.rows[0]);
    
    info('\n--- Testing DELETE operation ---');
    await client.exec("DELETE FROM notes WHERE title = 'Second Note'");
    info('Deleted second note');
    
    info('\n--- Testing SELECT after DELETE ---');
    const finalResult = await client.query('SELECT * FROM notes');
    info('Remaining notes:', finalResult.rows);
    
    info('\n--- Testing transaction ---');
    await client.transaction(async (tx) => {
      await tx.exec("INSERT INTO notes (title, content) VALUES ('Transaction Note 1', 'Content 1')");
      await tx.exec("INSERT INTO notes (title, content) VALUES ('Transaction Note 2', 'Content 2')");
      // Let's also query within the transaction to verify we can see our changes
      const txQueryResult = await tx.query('SELECT COUNT(*) as count FROM notes');
      info('Count within transaction:', txQueryResult.rows[0]);
    });
    info('Transaction completed successfully');
    
    info('\n--- Final verification ---');
    const finalVerification = await client.query('SELECT * FROM notes ORDER BY id');
    info('Final notes in database:', finalVerification.rows);
    
    info('\nAll comprehensive tests passed!');
    return true;
  } catch (error) {
    errorLog('Comprehensive test failed:', (error as Error).message);
    throw error;
  }
}

const program = new Command();

program
  .name('tributary')
  .description('CLI for Tributary operations')
  .version('1.0.0');

program
  .command('key')
  .description('Key management commands')
  .option('-g, --generate <name>', 'Generate a new key pair with the given name')
  .option('-l, --list', 'List all available keys')
  .option('-s, --show <name>', 'Show details of a specific key')
  .action(async (options) => {
    try {
      if (options.generate) {
        const keyName = options.generate;
        info(`Generating new key pair: ${keyName}`);
        const keyPair = generateKeyPair();
        await saveKeyPair(keyName, keyPair);
        info(`Key pair '${keyName}' generated and saved successfully.`);
      } else if (options.list) {
        info('Available keys:');
        const keys = await listKeys();
        if (keys.length === 0) {
          info('  No keys found.');
        } else {
          keys.forEach(key => info(`  ${key}`));
        }
      } else if (options.show) {
        const keyName = options.show;
        const keyDetails = await showKey(keyName);
        info(`Key: ${keyName}`);
        info(`Public Key: ${keyDetails.publicKey}`);
      } else {
        info('Please specify a key operation. Use --help for more information.');
      }
    } catch (error) {
      errorLog('Error:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('psql')
  .description('Execute SQL commands on Tributary collections')
  .argument('[sql]', 'SQL command to execute')
  .option('-r, --readkey <key>', 'Key to use for read operations')
  .option('-w, --writekey <key>', 'Key to use for write operations')
  .option('-d, --db <path>', 'Local database file path for persistence')
  .option('-c, --collection <id>', 'Collection ID to use (default: "default")')
  .option('-t, --test', 'Use test mode with FakeServer')
  .option('-n, --no-sync', 'Disable automatic sync with server before executing command')
  .action(async (sql, options) => {
    try {
      if (!sql && options.sync) {
        info('No SQL command provided. Use --help for more information.');
        process.exit(1);
      }
      
      if (options.test) {
        // For test mode, we'll run a simple test instead of executing the SQL directly
        info('Running test mode...');
        if (sql) {
          // If SQL was provided, we should execute it in test mode rather than run default test
          info('Executing custom SQL in test mode:', sql);
          
          // Generate a test key pair
          const keyPair = generateKeyPair();
          info('Generated test key pair');
          
          // Create a FakeServer instance for testing
          const fakeServer = new FakeServer();
          info('Created FakeServer instance');
          
          // Create a local database instance
          const db = new PGlite();
          info('Created local PGlite database');
          
          // Create a client instance
          const client = new TributaryClient({
            server: fakeServer,
            privateKey: keyPair.secretKey,
            collectionId: 'test-collection',
            db: db
          });
          info('Created TributaryClient instance');
          
          try {
            // Execute the provided SQL
            info('Executing SQL command...');
            const result = await client.query(sql);
            info('SQL command executed successfully');
            info('Result:', result);
            return;
          } catch (error) {
            errorLog('SQL execution failed:', (error as Error).message);
            throw error;
          }
        } else {
          // For test mode with no SQL, run comprehensive test
          await comprehensivePsqlTest();
        }
      } else {
        const result = await executeSQL(sql, {
          readKey: options.readkey,
          writeKey: options.writekey,
          localDb: options.db,
          collectionId: options.collection,
          sync: options.sync // This will be true by default, false if --no-sync is specified
        });
        info('Result:', result);
      }
    } catch (error) {
      errorLog('Error:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Run tests for Tributary CLI')
  .action(async () => {
    try {
      info('Running Tributary CLI tests...');
      await comprehensivePsqlTest();
      info('All tests completed successfully!');
    } catch (error) {
      errorLog('Test failed:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('comprehensive-test')
  .description('Run comprehensive tests for Tributary CLI')
  .action(async () => {
    try {
      info('Running comprehensive Tributary CLI tests...');
      await comprehensivePsqlTest();
      info('All comprehensive tests completed successfully!');
    } catch (error) {
      errorLog('Comprehensive test failed:', (error as Error).message);
      process.exit(1);
    }
  });

// Create static site management commands
const staticCmd = program
  .command('static')
  .description('Static site management commands');

staticCmd
  .command('up')
  .description('Upload a static site')
  .argument('<staticRoot>', 'Path to the static site root directory')
  .option('-w, --writekey <key>', 'Key to use for write operations')
  .option('-c, --collection <id>', 'Collection ID to use (default: "default")')
  .option('-t, --test', 'Use test mode with FakeServer')
  .action(async (staticRoot, options) => {
    try {
      if (!options.writekey) {
        errorLog('Error: Write key is required. Use --writekey to specify a key.');
        process.exit(1);
      }
      
      await uploadStaticSite({
        writeKey: options.writekey,
        staticRoot,
        collectionId: options.collection,
        useTestServer: options.test
      });
    } catch (error) {
      errorLog('Error:', (error as Error).message);
      process.exit(1);
    }
  });

staticCmd
  .command('ls')
  .description('List static site files')
  .option('-w, --writekey <key>', 'Key to use for write operations')
  .option('-c, --collection <id>', 'Collection ID to use (default: "default")')
  .option('-t, --test', 'Use test mode with FakeServer')
  .action(async (options) => {
    try {
      if (!options.writekey) {
        errorLog('Error: Write key is required. Use --writekey to specify a key.');
        process.exit(1);
      }
      
      await listStaticSite({
        writeKey: options.writekey,
        collectionId: options.collection,
        useTestServer: options.test
      });
    } catch (error) {
      errorLog('Error:', (error as Error).message);
      process.exit(1);
    }
  });

staticCmd
  .command('cat')
  .description('Retrieve a static site file')
  .argument('<filePath>', 'Path to the file to retrieve')
  .option('-w, --writekey <key>', 'Key to use for write operations')
  .option('-c, --collection <id>', 'Collection ID to use (default: "default")')
  .option('-t, --test', 'Use test mode with FakeServer')
  .action(async (filePath, options) => {
    try {
      if (!options.writekey) {
        errorLog('Error: Write key is required. Use --writekey to specify a key.');
        process.exit(1);
      }
      
      await catStaticSiteFile({
        writeKey: options.writekey,
        filePath,
        collectionId: options.collection,
        useTestServer: options.test
      });
    } catch (error) {
      errorLog('Error:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
