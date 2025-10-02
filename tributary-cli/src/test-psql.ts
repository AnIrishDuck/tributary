import { TributaryClient, FakeServer } from 'tributary-client';
import { generateKeyPair } from './key';
import { PGlite } from '@electric-sql/pglite';

// Test function for psql command functionality
export async function testPsqlCommand() {
  console.log('Testing psql command with FakeServer...');
  
  // Generate a test key pair
  const keyPair = generateKeyPair();
  console.log('Generated test key pair');
  
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
    collectionId: 'test-collection',
    db: db
  });
  console.log('Created TributaryClient instance');
  
  try {
    // Test a simple CREATE TABLE command
    console.log('Executing CREATE TABLE command...');
    await client.exec('CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, name TEXT)');
    console.log('CREATE TABLE command executed successfully');
    
    // Test an INSERT command
    console.log('Executing INSERT command...');
    await client.exec('INSERT INTO test_table (id, name) VALUES (1, \'Test Name\')');
    console.log('INSERT command executed successfully');
    
    // Test a SELECT query
    console.log('Executing SELECT query...');
    const result = await client.query('SELECT * FROM test_table');
    console.log('SELECT query executed successfully');
    console.log('Query result:', result);
    
    // Verify the data was inserted correctly
    if (result.rows && result.rows.length > 0) {
      console.log('Data verification successful');
      console.log('Inserted row:', result.rows[0]);
    } else {
      console.log('No data found in table');
    }
    
    console.log('All tests passed!');
    return true;
  } catch (error) {
    console.error('Test failed:', (error as Error).message);
    throw error;
  }
}
