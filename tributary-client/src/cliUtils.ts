// Utility function for creating CLI servers
// This function returns a TributaryServer based on the TRIBUTARY_CLI_URL environment variable
import { Server } from './server.js';
import { TributaryServer } from './tributaryServer.js';

/**
 * Creates a CLI server instance for use in CLI applications
 * Uses TRIBUTARY_CLI_URL and TRIBUTARY_CLI_KEY environment variables
 * @returns Server instance (TributaryServer)
 * @throws Error if TRIBUTARY_CLI_URL is not set
 */
export function createCliServer(): Server {
  const cliUrl = process.env.TRIBUTARY_CLI_URL;
  const cliKey = process.env.TRIBUTARY_CLI_KEY;
  
  if (!cliUrl) {
    throw new Error('TRIBUTARY_CLI_URL environment variable must be set');
  }
  
  // Return a TributaryServer with the CLI URL and optional key
  return new TributaryServer(cliUrl, cliKey);
}
