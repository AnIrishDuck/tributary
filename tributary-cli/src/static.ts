import { TributaryClient, FakeServer, TributaryServer } from 'tributary-client';
import { loadKeyPair } from './key';
import { PGlite } from '@electric-sql/pglite';
import { createNodeFileReader } from 'tributary-client';
import { promises as fs } from 'fs';
import { resolve, relative, join } from 'path';
import { logger, info, error as errorLog, warn } from './logger';

/**
 * Upload a static site to a Tributary collection
 * @param options Upload options
 */
export async function uploadStaticSite(options: {
  writeKey: string;
  staticRoot: string;
  collectionId?: string;
  useTestServer?: boolean;
}): Promise<void> {
  try {
    // Load the write key
    const keyPair = await loadKeyPair(options.writeKey);
    
    // Create server instance
    const server = options.useTestServer ? new FakeServer() : new TributaryServer('http://tributary:8080');
    
    // Create a local database instance
    const db = new PGlite();
    
    // Create a client instance
    const client = new TributaryClient({
      server,
      privateKey: keyPair.secretKey,
      collectionId: options.collectionId || 'default',
      db
    });
    
    // Resolve the static root path
    const staticRoot = resolve(options.staticRoot);
    
    // Check if the static root exists and is a directory
    try {
      const stat = await fs.stat(staticRoot);
      if (!stat.isDirectory()) {
        throw new Error(`Static root is not a directory: ${staticRoot}`);
      }
    } catch (err) {
      throw new Error(`Static root does not exist or is not accessible: ${staticRoot}`);
    }
    
    // Walk the directory and collect all files
    const files: Record<string, { path: string; contentType: string }> = {};
    
    async function walkDir(dir: string): Promise<void> {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        const relativePath = relative(staticRoot, fullPath);
        
        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else if (entry.isFile()) {
          // Determine content type based on file extension
          const contentType = getContentType(entry.name);
          files[fullPath] = {
            path: relativePath.replace(/\\/g, '/'), // Normalize path separators
            contentType
          };
        }
      }
    }
    
    await walkDir(staticRoot);
    
    info(`Found ${Object.keys(files).length} files to upload`);
    
    // Create file reader for Node.js environment
    const fileReader = createNodeFileReader(fs);
    
    // Upload the static site
    await client.uploadStaticSite(files, fileReader);
    
    // Output directory listing as JSON
    const directory = await client.listStaticSite();
    console.log(JSON.stringify(directory, null, 2));
    
    info('Static site upload completed successfully');
  } catch (error) {
    errorLog('Error uploading static site:', (error as Error).message);
    throw error;
  }
}

/**
 * List static site files in a Tributary collection
 * @param options List options
 */
export async function listStaticSite(options: {
  writeKey: string;
  collectionId?: string;
  useTestServer?: boolean;
}): Promise<void> {
  try {
    // Load the write key
    const keyPair = await loadKeyPair(options.writeKey);
    
    // Create server instance
    const server = options.useTestServer ? new FakeServer() : new TributaryServer('http://tributary:8080');
    
    // Create a local database instance
    const db = new PGlite();
    
    // Create a client instance
    const client = new TributaryClient({
      server,
      privateKey: keyPair.secretKey,
      collectionId: options.collectionId || 'default',
      db
    });
    
    // List the static site files
    const directory = await client.listStaticSite();
    
    // Print directory listing in a human-readable format
    if (Object.keys(directory).length === 0) {
      console.log('No files found in static site');
      return;
    }
    
    console.log('Static site files:');
    for (const [filePath, fileInfo] of Object.entries(directory)) {
      console.log(`  ${filePath} (${fileInfo['content-type']})`);
    }
  } catch (error) {
    errorLog('Error listing static site files:', (error as Error).message);
    throw error;
  }
}

/**
 * Retrieve a static site file from a Tributary collection
 * @param options Retrieve options
 */
export async function catStaticSiteFile(options: {
  writeKey: string;
  filePath: string;
  collectionId?: string;
  useTestServer?: boolean;
}): Promise<void> {
  try {
    // Load the write key
    const keyPair = await loadKeyPair(options.writeKey);
    
    // Create server instance
    const server = options.useTestServer ? new FakeServer() : new TributaryServer('http://tributary:8080');
    
    // Create a local database instance
    const db = new PGlite();
    
    // Create a client instance
    const client = new TributaryClient({
      server,
      privateKey: keyPair.secretKey,
      collectionId: options.collectionId || 'default',
      db
    });
    
    // Retrieve the file
    const result = await client.getStaticSiteFile(options.filePath);
    
    if (!result) {
      console.log(`File not found: ${options.filePath}`);
      return;
    }
    
    // Output the file content to stdout
    process.stdout.write(result.content);
  } catch (error) {
    errorLog('Error retrieving static site file:', (error as Error).message);
    throw error;
  }
}

/**
 * Determine content type based on file extension
 * @param filename The filename
 * @returns The MIME content type
 */
function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  
  const contentTypes: Record<string, string> = {
    'html': 'text/html',
    'htm': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'txt': 'text/plain',
    'md': 'text/markdown',
    'pdf': 'application/pdf',
    'zip': 'application/zip',
    'xml': 'application/xml',
    'woff': 'font/woff',
    'woff2': 'font/woff2',
    'ttf': 'font/ttf',
    'eot': 'application/vnd.ms-fontobject'
  };
  
  return contentTypes[ext] || 'application/octet-stream';
}
