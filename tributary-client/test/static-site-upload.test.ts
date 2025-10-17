// Test for static site upload functionality
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TributaryClient } from '../src/tributaryClient';
import { FakeServer } from '../src/fakeServer';
import { createStringFileReader } from '../src/fileUtils';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

describe.skip('Static Site Upload', () => {
  let client: TributaryClient;
  let server: FakeServer;
  let privateKey: Uint8Array;
  let publicKey: Uint8Array;

  beforeEach(() => {
    // Generate keypair for testing
    const keyPair = nacl.sign.keyPair();
    privateKey = keyPair.secretKey;
    publicKey = keyPair.publicKey;
    
    const privateKeyBase64 = encodeBase64(privateKey);
    
    // Create fake server and client for testing
    server = new FakeServer();
    client = new TributaryClient({
      server,
      privateKey: privateKeyBase64,
      collectionId: 'test-collection'
    });
  });

  it('should upload static site files and directory structure', async () => {
    // Define files to upload
    const files = {
      '/local/index.html': {
        path: 'index.html',
        contentType: 'text/html'
      },
      '/local/style.css': {
        path: 'style.css',
        contentType: 'text/css'
      }
    };

    // Create file reader
    const fileReader = createStringFileReader();

    // Upload static site
    await client.uploadStaticSite(files, (localPath) => {
      switch (localPath) {
        case '/local/index.html':
          return fileReader('<h1>Hello World</h1>');
        case '/local/style.css':
          return fileReader('body { color: blue; }');
        default:
          throw new Error(`Unknown file: ${localPath}`);
      }
    });

    // Verify files were uploaded
    const allBlobs = server.getAllBlobs(encodeBase64(publicKey));
    expect(allBlobs).toHaveLength(3); // 2 files + 1 directory structure

    // Verify directory structure (last blob)
    const directoryBlob = allBlobs[2];
    const decryptedDirectoryData = client['decryptData'](directoryBlob.data);
    const directoryContent = new TextDecoder().decode(decryptedDirectoryData);
    const directoryJson = JSON.parse(directoryContent);
    
    expect(directoryJson.directory).toBeDefined();
    expect(directoryJson.directory['index.html']).toBeDefined();
    expect(directoryJson.directory['style.css']).toBeDefined();
    
    // Verify file indices and content types
    expect(directoryJson.directory['index.html'].ix).toBe(0);
    expect(directoryJson.directory['index.html']['content-type']).toBe('text/html');
    expect(directoryJson.directory['style.css'].ix).toBe(1);
    expect(directoryJson.directory['style.css']['content-type']).toBe('text/css');
  });

  it('should handle empty file list', async () => {
    const files = {};
    const fileReader = createStringFileReader();

    await client.uploadStaticSite(files, fileReader);

    // Should only upload directory structure
    const allBlobs = server.getAllBlobs(encodeBase64(publicKey));
    expect(allBlobs).toHaveLength(1);

    // Verify empty directory structure
    const directoryBlob = allBlobs[0];
    const decryptedDirectoryData = client['decryptData'](directoryBlob.data);
    const directoryContent = new TextDecoder().decode(decryptedDirectoryData);
    const directoryJson = JSON.parse(directoryContent);
    
    expect(directoryJson.directory).toEqual({});
  });

  it('should maintain proper cryptographic chaining', async () => {
    const files = {
      '/local/file1.txt': {
        path: 'file1.txt',
        contentType: 'text/plain'
      }
    };

    const fileReader = createStringFileReader();
    
    await client.uploadStaticSite(files, (localPath) => {
      return fileReader('test content');
    });

    // Verify chaining by checking hashes
    const allBlobs = server.getAllBlobs(encodeBase64(publicKey));
    expect(allBlobs).toHaveLength(2); // 1 file + 1 directory structure
    
    // First blob (file) should have empty prior hash
    expect(allBlobs[0].priorHash).toBe('');
    
    // Second blob (directory) should have first blob's hash as prior hash
    expect(allBlobs[1].priorHash).toBe(allBlobs[0].hash);
  });

  it('should list static site files', async () => {
    // Define files to upload
    const files = {
      '/local/index.html': {
        path: 'index.html',
        contentType: 'text/html'
      },
      '/local/style.css': {
        path: 'style.css',
        contentType: 'text/css'
      }
    };

    // Create file reader
    const fileReader = createStringFileReader();

    // Upload static site
    await client.uploadStaticSite(files, (localPath) => {
      switch (localPath) {
        case '/local/index.html':
          return fileReader('<h1>Hello World</h1>');
        case '/local/style.css':
          return fileReader('body { color: blue; }');
        default:
          throw new Error(`Unknown file: ${localPath}`);
      }
    });

    // List static site files
    const directory = await client.listStaticSite();
    
    expect(directory).toBeDefined();
    expect(Object.keys(directory)).toHaveLength(2);
    expect(directory['index.html']).toBeDefined();
    expect(directory['style.css']).toBeDefined();
    
    // Verify file indices and content types
    expect(directory['index.html'].ix).toBe(0);
    expect(directory['index.html']['content-type']).toBe('text/html');
    expect(directory['style.css'].ix).toBe(1);
    expect(directory['style.css']['content-type']).toBe('text/css');
  });

  it('should retrieve static site files', async () => {
    // Define files to upload
    const files = {
      '/local/index.html': {
        path: 'index.html',
        contentType: 'text/html'
      }
    };

    // Create file reader
    const fileReader = createStringFileReader();
    const fileContent = '<h1>Hello World</h1>';

    // Upload static site
    await client.uploadStaticSite(files, (localPath) => {
      return fileReader(fileContent);
    });

    // Retrieve the file
    const result = await client.getStaticSiteFile('index.html');
    
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
    
    if (result) {
      expect(result.contentType).toBe('text/html');
      const retrievedContent = new TextDecoder().decode(result.content);
      expect(retrievedContent).toBe(fileContent);
    }
  });

  it('should return null for non-existent static site files', async () => {
    // Define files to upload
    const files = {
      '/local/index.html': {
        path: 'index.html',
        contentType: 'text/html'
      }
    };

    // Create file reader
    const fileReader = createStringFileReader();

    // Upload static site
    await client.uploadStaticSite(files, (localPath) => {
      return fileReader('<h1>Hello World</h1>');
    });

    // Try to retrieve a non-existent file
    const result = await client.getStaticSiteFile('non-existent.html');
    
    expect(result).toBeNull();
  });
});
