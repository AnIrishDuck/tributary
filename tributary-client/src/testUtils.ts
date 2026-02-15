// Utility function for creating test servers
// This function returns either a FakeServer or a real TributaryServer
// based on the TRIBUTARY_TEST_URL environment variable
import { Server } from './server.js';
import { FakeServer } from './fakeServer.js';
import { TributaryServer } from './tributaryServer.js';

/**
 * Creates a test server instance for use in tests
 * @returns Server instance (either FakeServer or TributaryServer)
 */
export function createTestServer(): Server {
  const testUrl = process.env.TRIBUTARY_TEST_URL;
  const testKey = process.env.TRIBUTARY_TEST_KEY;
  
  if (testUrl) {
    // Return a real TributaryServer when TRIBUTARY_TEST_URL is set
    return new TributaryServer(testUrl, testKey);
  } else {
    // Return a FakeServer by default
    return new FakeServer();
  }
}
