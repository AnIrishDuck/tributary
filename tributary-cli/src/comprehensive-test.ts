#!/usr/bin/env node

// Comprehensive test for psql command functionality
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

// Run the comprehensive test
comprehensivePsqlTest().catch(console.error);
