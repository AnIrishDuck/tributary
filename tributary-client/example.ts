// Example usage of tributary-client
import { TributaryClient, TributaryServer, FakeServer } from './src/index';
import nacl from 'tweetnacl';
import { encodeBase64 } from 'tweetnacl-util';

async function example() {
  console.log('Tributary Client Example');
  
  // Create a fake server for testing
  const fakeServer = new FakeServer();
  
  // Generate a key pair for testing
  const keyPair = nacl.sign.keyPair();
  const privateKeyBase64 = encodeBase64(keyPair.secretKey);
  const publicKeyBase64 = encodeBase64(keyPair.publicKey);
  
  console.log('Public Key:', publicKeyBase64);
  
  // Create a TributaryClient
  const client = new TributaryClient({
    server: fakeServer
  });
  
  console.log('TributaryClient created successfully');
  
  // Add a stream with a write key
  const stream = await client.addWriteKey(privateKeyBase64, 'scribe', 'stream1');
  console.log('TributaryStream created successfully');
  
  // List all streams
  const streams = await client.list();
  console.log('Streams:', streams);
  
  // Get a stream by ID
  const retrievedStream = await client.get(stream.getId());
  console.log('Retrieved stream:', retrievedStream ? 'found' : 'not found');
  
  // Create a real server connection (for production use)
  const realServer = new TributaryServer('http://localhost:8080');
  console.log('TributaryServer created for URL: http://localhost:8080');
  
  // Example of using the stream for database operations
  try {
    // Create a table
    await stream.exec('CREATE TABLE IF NOT EXISTS documents (id SERIAL PRIMARY KEY, title TEXT, content TEXT)');
    
    // Insert a document
    await stream.exec('INSERT INTO documents (title, content) VALUES ($1, $2)', ['Hello World', 'This is a test document']);
    
    // Query documents
    const result = await stream.query('SELECT * FROM documents');
    console.log('Documents:', result.rows);
  } catch (error) {
    console.error('Error with database operations:', error);
  }
}

// Run the example
example().catch(console.error);
