#!/usr/bin/env node

import { Command } from 'commander';
import { generateKeyPair, saveKeyPair, listKeys, showKey } from './key';
import { executeSQL } from './psql';
import { testPsqlCommand } from './test-psql';

// Comprehensive test function
import { TributaryClient, FakeServer } from 'tributary-client';
import { loadKeyPair } from './key';
import { PGlite } from '@electric-sql/pglite';

async function comprehensivePsqlTest() {
  console.log('Running comprehensive psql command test...');
  
  try {
    // Load our existing test key
    const keyPair = await loadKeyPair('test-key');
    console.log('Loaded existing test key');
    
    // Create a FakeServer instance for testing
    const fakeServer = new FakeServer();
    console.log('Created FakeServer instance');
    
    // Create a local database instance
    const db = new PGlite();
    console.log('Created local PGlite database');
    
    // Create a client instance
    const client = new TributaryClient({
      server: fakeServer,
      privateKey: keyPair.secretKey,
      collectionId: 'comprehensive-test-collection',
      db: db
    });
    console.log('Created TributaryClient instance');
    
    // Test a series of SQL operations
    console.log('\n--- Testing CREATE TABLE ---');
    await client.exec(`
      CREATE TABLE IF NOT EXISTS notes (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Created notes table');
    
    console.log('\n--- Testing INSERT operations ---');
    await client.exec(
      "INSERT INTO notes (title, content) VALUES ('First Note', 'This is the content of the first note')",
    );
    console.log('Inserted first note');
    
    await client.exec(
      "INSERT INTO notes (title, content) VALUES ('Second Note', 'This is the content of the second note')",
    );
    console.log('Inserted second note');
    
    console.log('\n--- Testing SELECT query ---');
    const selectResult = await client.query('SELECT * FROM notes ORDER BY id');
    console.log('Selected notes:', selectResult.rows);
    
    console.log('\n--- Testing UPDATE operation ---');
    await client.exec("UPDATE notes SET content = 'Updated content' WHERE title = 'First Note'");
    console.log('Updated first note');
    
    console.log('\n--- Testing SELECT after UPDATE ---');
    const updatedResult = await client.query('SELECT * FROM notes WHERE title = \'First Note\'');
    console.log('Updated note:', updatedResult.rows[0]);
    
    console.log('\n--- Testing DELETE operation ---');
    await client.exec("DELETE FROM notes WHERE title = 'Second Note'");
    console.log('Deleted second note');
    
    console.log('\n--- Testing SELECT after DELETE ---');
    const finalResult = await client.query('SELECT * FROM notes');
    console.log('Remaining notes:', finalResult.rows);
    
    console.log('\n--- Testing transaction ---');
    await client.transaction(async (tx) => {
      await tx.exec("INSERT INTO notes (title, content) VALUES ('Transaction Note 1', 'Content 1')");
      await tx.exec("INSERT INTO notes (title, content) VALUES ('Transaction Note 2', 'Content 2')");
      // Let's also query within the transaction to verify we can see our changes
      const txQueryResult = await tx.query('SELECT COUNT(*) as count FROM notes');
      console.log('Count within transaction:', txQueryResult.rows[0]);
    });
    console.log('Transaction completed successfully');
    
    console.log('\n--- Final verification ---');
    const finalVerification = await client.query('SELECT * FROM notes ORDER BY id');
    console.log('Final notes in database:', finalVerification.rows);
    
    console.log('\nAll comprehensive tests passed!');
    return true;
  } catch (error) {
    console.error('Comprehensive test failed:', (error as Error).message);
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
        console.log(`Generating new key pair: ${keyName}`);
        const keyPair = generateKeyPair();
        await saveKeyPair(keyName, keyPair);
        console.log(`Key pair '${keyName}' generated and saved successfully.`);
      } else if (options.list) {
        console.log('Available keys:');
        const keys = await listKeys();
        if (keys.length === 0) {
          console.log('  No keys found.');
        } else {
          keys.forEach(key => console.log(`  ${key}`));
        }
      } else if (options.show) {
        const keyName = options.show;
        const keyDetails = await showKey(keyName);
        console.log(`Key: ${keyName}`);
        console.log(`Public Key: ${keyDetails.publicKey}`);
      } else {
        console.log('Please specify a key operation. Use --help for more information.');
      }
    } catch (error) {
      console.error('Error:', (error as Error).message);
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
  .action(async (sql, options) => {
    try {
      if (!sql) {
        console.log('No SQL command provided. Use --help for more information.');
        process.exit(1);
      }
      
      if (options.test) {
        // Import the test version of executeSQL
        const { testPsqlCommand } = await import('./test-psql');
        // For test mode, we'll run a simple test instead of executing the SQL directly
        console.log('Running test mode...');
        await testPsqlCommand();
      } else {
        const result = await executeSQL(sql, {
          readKey: options.readkey,
          writeKey: options.writekey,
          localDb: options.db,
          collectionId: options.collection
        });
        console.log('Result:', result);
      }
    } catch (error) {
      console.error('Error:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Run tests for Tributary CLI')
  .action(async () => {
    try {
      console.log('Running Tributary CLI tests...');
      await testPsqlCommand();
      console.log('All tests completed successfully!');
    } catch (error) {
      console.error('Test failed:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('comprehensive-test')
  .description('Run comprehensive tests for Tributary CLI')
  .action(async () => {
    try {
      console.log('Running comprehensive Tributary CLI tests...');
      await comprehensivePsqlTest();
      console.log('All comprehensive tests completed successfully!');
    } catch (error) {
      console.error('Comprehensive test failed:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
