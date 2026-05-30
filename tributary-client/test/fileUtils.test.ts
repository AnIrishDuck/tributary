import { describe, it, expect } from 'vitest';
import {
  createNodeFileReader,
  createStringFileReader,
  createDragAndDropFileReader,
  createBrowserFileReader,
} from '../src/fileUtils';

describe('createStringFileReader', () => {
  it('encodes a string to Uint8Array', () => {
    const read = createStringFileReader();
    const result = read('hello');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toBe('hello');
  });

  it('handles empty string', () => {
    const read = createStringFileReader();
    const result = read('');
    expect(result.length).toBe(0);
  });
});

describe('createNodeFileReader', () => {
  it('reads a file and returns Uint8Array', async () => {
    const contents = Buffer.from('file data');
    const fs = { readFile: async () => contents };
    const read = createNodeFileReader(fs);
    const result = await read('/some/path');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toBe('file data');
  });

  it('propagates fs errors', async () => {
    const fs = { readFile: async () => { throw new Error('ENOENT'); } };
    const read = createNodeFileReader(fs);
    await expect(read('/missing')).rejects.toThrow('ENOENT');
  });
});

describe('createBrowserFileReader', () => {
  it('reads a File to Uint8Array', async () => {
    const file = new File(['browser content'], 'test.txt');
    const read = createBrowserFileReader();
    const result = await read(file);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toBe('browser content');
  });
});

describe('createDragAndDropFileReader', () => {
  it('reads a DataTransferItem to Uint8Array', async () => {
    const file = new File(['dropped'], 'drop.txt');
    const item = { getAsFile: () => file } as unknown as DataTransferItem;
    const read = createDragAndDropFileReader();
    const result = await read(item);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toBe('dropped');
  });

  it('throws when getAsFile returns null', async () => {
    const item = { getAsFile: () => null } as unknown as DataTransferItem;
    const read = createDragAndDropFileReader();
    await expect(read(item)).rejects.toThrow('Failed to get file from DataTransferItem');
  });
});
