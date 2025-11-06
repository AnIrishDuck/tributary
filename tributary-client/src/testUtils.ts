// Utility function for creating test servers
// This function returns either a FakeServer or a real TributaryServer
// based on the TRIBUTARY_TEST_URL environment variable
import { Server } from '../src/server';
import { FakeServer } from '../src/fakeServer';
import { TributaryServer } from '../src/tributaryServer';

/**
 * Creates a test server instance for use in tests
 * @returns Server instance (either FakeServer or TributaryServer)
 */
export function createTestServer(): Server {
  const testUrl = process.env.TRIBUTARY_TEST_URL;
  
  if (testUrl) {
    // Return a real TributaryServer when TRIBUTARY_TEST_URL is set
    return new TributaryServer(testUrl);
  } else {
    // Return a FakeServer by default
    return new FakeServer();
  }
}
