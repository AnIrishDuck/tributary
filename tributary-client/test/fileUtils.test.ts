import { describe, it, expect } from 'vitest';
import { createNodeFileReader, createStringFileReader, createDragAndDropFileReader } from '../src/fileUtils';
import type { FileSystem } from '../src/fileUtils';

describe('createStringFileReader', () => {
  it('encodes a string as UTF-8 bytes', () => {
    const reader = createStringFileReader();
    const result = reader('hello');
    expect(result).toEqual(new TextEncoder().encode('hello'));
  });

  it('handles empty string', () => {
    const reader = createStringFileReader();
    const result = reader('');
    expect(result).toEqual(new Uint8Array(0));
  });

  it('handles unicode', () => {
    const reader = createStringFileReader();
    const result = reader('héllo 🌍');
    expect(result).toEqual(new TextEncoder().encode('héllo 🌍'));
  });
});

describe('createNodeFileReader', () => {
  it('reads a file and returns Uint8Array', async () => {
    const content = new Uint8Array([1, 2, 3, 4, 5]);
    const fakeFs: FileSystem = {
      readFile: async () => content,
    };

    const reader = createNodeFileReader(fakeFs);
    const result = await reader('/some/path.bin');
    expect(result).toEqual(content);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('converts Buffer-like results to Uint8Array', async () => {
    const buffer = Buffer.from([10, 20, 30]);
    const fakeFs: FileSystem = {
      readFile: async () => buffer,
    };

    const reader = createNodeFileReader(fakeFs);
    const result = await reader('/file.bin');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(Array.from(result)).toEqual([10, 20, 30]);
  });

  it('propagates read errors', async () => {
    const fakeFs: FileSystem = {
      readFile: async () => { throw new Error('ENOENT'); },
    };

    const reader = createNodeFileReader(fakeFs);
    await expect(reader('/missing')).rejects.toThrow('ENOENT');
  });
});

describe('createDragAndDropFileReader', () => {
  it('rejects when getAsFile returns null', async () => {
    const reader = createDragAndDropFileReader();
    const fakeItem = {
      getAsFile: () => null,
    } as unknown as DataTransferItem;

    await expect(reader(fakeItem)).rejects.toThrow('DataTransferItem did not contain a file');
  });

  it('reads file content from DataTransferItem', async () => {
    const content = new Uint8Array([7, 8, 9]);
    const reader = createDragAndDropFileReader();
    const fakeFile = {
      arrayBuffer: async () => content.buffer,
    };
    const fakeItem = {
      getAsFile: () => fakeFile,
    } as unknown as DataTransferItem;

    const result = await reader(fakeItem);
    expect(result).toEqual(content);
  });

  it('rejects when arrayBuffer fails', async () => {
    const reader = createDragAndDropFileReader();
    const fakeFile = {
      arrayBuffer: async () => { throw new Error('read failed'); },
    };
    const fakeItem = {
      getAsFile: () => fakeFile,
    } as unknown as DataTransferItem;

    await expect(reader(fakeItem)).rejects.toThrow('read failed');
  });
});
