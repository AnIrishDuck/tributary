import { FileMeta, StorageBackend } from './types.js';

/**
 * In-memory StorageBackend for testing.
 *
 * Stores pages and metadata in plain Maps. No persistence, no async,
 * no browser APIs. Useful for unit-testing the PageCache in isolation.
 */
export class MemoryBackend implements StorageBackend {
  private meta = new Map<string, FileMeta>();
  private pages = new Map<string, Uint8Array>();

  readPage(fileId: string, pageIndex: number): Uint8Array | null {
    return this.pages.get(pk(fileId, pageIndex)) ?? null;
  }

  writePage(fileId: string, pageIndex: number, data: Uint8Array): void {
    this.pages.set(pk(fileId, pageIndex), data);
  }

  writePages(
    pages: Array<{ fileId: string; pageIndex: number; data: Uint8Array }>,
  ): void {
    for (const p of pages) {
      this.writePage(p.fileId, p.pageIndex, p.data);
    }
  }

  getFileMeta(fileId: string): FileMeta | null {
    return this.meta.get(fileId) ?? null;
  }

  setFileMeta(fileId: string, meta: FileMeta): void {
    this.meta.set(fileId, { ...meta });
  }

  deleteFile(fileId: string): void {
    this.meta.delete(fileId);
    // Delete all pages for this file.
    const prefix = fileId + '\0';
    for (const key of [...this.pages.keys()]) {
      if (key.startsWith(prefix)) {
        this.pages.delete(key);
      }
    }
  }

  listFiles(prefix: string): string[] {
    const result: string[] = [];
    for (const key of this.meta.keys()) {
      if (key.startsWith(prefix)) {
        result.push(key);
      }
    }
    return result;
  }

  renameFile(oldId: string, newId: string): void {
    const meta = this.meta.get(oldId);
    if (meta) {
      this.meta.set(newId, meta);
      this.meta.delete(oldId);
    }
    const oldPrefix = oldId + '\0';
    const newPrefix = newId + '\0';
    for (const key of [...this.pages.keys()]) {
      if (key.startsWith(oldPrefix)) {
        const suffix = key.slice(oldPrefix.length);
        this.pages.set(newPrefix + suffix, this.pages.get(key)!);
        this.pages.delete(key);
      }
    }
  }
}

function pk(fileId: string, pageIndex: number): string {
  return `${fileId}\0${pageIndex}`;
}
