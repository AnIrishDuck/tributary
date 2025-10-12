// Example: Uploading a static site using TributaryClient

import { TributaryClient, Server, createStringFileReader } from './src/index';

// Example showing how to upload a static site
async function uploadStaticSiteExample(client: TributaryClient, server: Server) {
  // Define the files to upload with their static site paths and content types
  const files = {
    '/path/to/local/index.html': {
      path: 'index.html',
      contentType: 'text/html'
    },
    '/path/to/local/style.css': {
      path: 'style.css',
      contentType: 'text/css'
    },
    '/path/to/local/script.js': {
      path: 'script.js',
      contentType: 'application/javascript'
    },
    '/path/to/local/images/logo.png': {
      path: 'images/logo.png',
      contentType: 'image/png'
    }
  };

  // Create a file reader function for string content (for testing purposes)
  const fileReader = createStringFileReader();

  // Upload the static site
  await client.uploadStaticSite(files, (localPath) => {
    // In a real implementation, you would read the actual file content
    // For this example, we're returning sample content based on the file path
    switch (localPath) {
      case '/path/to/local/index.html':
        return fileReader('<html><head><link rel="stylesheet" href="style.css"></head><body><h1>Hello World</h1><script src="script.js"></script></body></html>');
      case '/path/to/local/style.css':
        return fileReader('body { font-family: Arial, sans-serif; }');
      case '/path/to/local/script.js':
        return fileReader('console.log("Hello from script!");');
      case '/path/to/local/images/logo.png':
        // In a real implementation, this would be actual image data
        return fileReader('mock PNG data');
      default:
        throw new Error(`Unknown file: ${localPath}`);
    }
  });

  console.log('Static site uploaded successfully!');
}

// Example for Node.js environment
async function nodeJsExample() {
  // In a Node.js environment, you would import the fs module:
  // import { promises as fs } from 'fs';
  // const fileReader = createNodeFileReader(fs);
  
  // Then use it like:
  // await client.uploadStaticSite(files, fileReader);
  console.log('Node.js example ready');
}

// Example for browser environment with File objects
async function browserFileExample() {
  // In a browser environment with File objects:
  // const fileReader = createBrowserFileReader();
  
  // Then use it like:
  // await client.uploadStaticSite(files, fileReader);
  console.log('Browser File example ready');
}

// Example for drag and drop in browser
async function dragAndDropExample() {
  // In a browser environment with drag and drop:
  // const fileReader = createDragAndDropFileReader();
  
  // Then use it like:
  // await client.uploadStaticSite(files, fileReader);
  console.log('Drag and drop example ready');
}

export {
  uploadStaticSiteExample,
  nodeJsExample,
  browserFileExample,
  dragAndDropExample
};
