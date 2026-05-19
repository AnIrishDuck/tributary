// Utility functions for working with files in different environments

/**
 * Create a file reader function for Node.js environment
 * @param fs The Node.js fs module (promises version)
 * @returns A function that reads file content as Uint8Array
 */
export function createNodeFileReader(fs: { readFile(path: string): Promise<Buffer> }) {
  return async function (localPath: string): Promise<Uint8Array> {
    const buffer = await fs.readFile(localPath);
    return new Uint8Array(buffer);
  };
}

/**
 * Create a file reader function for browser environment with File objects
 * @returns A function that reads file content as Uint8Array
 */
export function createBrowserFileReader() {
  return async function (file: File): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const arrayBuffer = reader.result as ArrayBuffer;
        resolve(new Uint8Array(arrayBuffer));
      };
      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };
      reader.readAsArrayBuffer(file);
    });
  };
}

/**
 * Create a file reader function for browser environment with drag and drop
 * @returns A function that reads file content as Uint8Array
 */
export function createDragAndDropFileReader() {
  return async function (dataTransferItem: DataTransferItem): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      dataTransferItem.getAsFile()?.arrayBuffer()
        .then(buffer => resolve(new Uint8Array(buffer)))
        .catch(reject);
    });
  };
}

/**
 * Create a simple file reader function for testing with string content
 * @returns A function that creates Uint8Array from string content
 */
export function createStringFileReader() {
  return function (content: string): Uint8Array {
    return new TextEncoder().encode(content);
  };
}
