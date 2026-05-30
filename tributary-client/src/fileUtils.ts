// Utility functions for working with files in different environments

export interface NodeFsLike {
  readFile(path: string): Promise<Buffer>;
}

export function createNodeFileReader(fs: NodeFsLike) {
  return async function (localPath: string): Promise<Uint8Array> {
    const buffer = await fs.readFile(localPath);
    return new Uint8Array(buffer);
  };
}

export function createBrowserFileReader() {
  return async function (file: File): Promise<Uint8Array> {
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  };
}

export function createDragAndDropFileReader() {
  return async function (dataTransferItem: DataTransferItem): Promise<Uint8Array> {
    const file = dataTransferItem.getAsFile();
    if (!file) {
      throw new Error('Failed to get file from DataTransferItem');
    }
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  };
}

export function createStringFileReader() {
  return function (content: string): Uint8Array {
    return new TextEncoder().encode(content);
  };
}
