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
    server: fakeServer,
    privateKey: privateKeyBase64
  });
  
  console.log('TributaryClient created successfully');
  
  // Create a real server connection (for production use)
  const realServer = new TributaryServer('http://localhost:8080');
  console.log('TributaryServer created for URL: http://localhost:8080');
  
  // Example of using the client for database operations would go here
  // For now, we'll just show the setup
}

// Run the example
example().catch(console.error);
