/** Size of a single page in bytes. Matches Postgres internal page size. */
export const PAGE_SIZE = 8192;

/** Metadata for a file stored in the backend. */
export interface FileMeta {
  size: number;
  mode: number;
  ctime: number;
  mtime: number;
  /** True if this is a directory. */
  isDir: boolean;
}

/** A single cached page. */
export interface CachePage {
  fileId: string;
  pageIndex: number;
  data: Uint8Array;
  dirty: boolean;
}

/**
 * Abstract storage backend interface.
 *
 * All methods are synchronous because the caller (Emscripten FS) is
 * synchronous. Implementations that talk to async storage (IndexedDB)
 * must use a sync bridge (SAB+Atomics) internally.
 */
export interface StorageBackend {
  readPage(fileId: string, pageIndex: number): Uint8Array | null;
  writePage(fileId: string, pageIndex: number, data: Uint8Array): void;
  writePages(
    pages: Array<{ fileId: string; pageIndex: number; data: Uint8Array }>,
  ): void;
  getFileMeta(fileId: string): FileMeta | null;
  setFileMeta(fileId: string, meta: FileMeta): void;
  deleteFile(fileId: string): void;
  listFiles(prefix: string): string[];
  renameFile(oldId: string, newId: string): void;
}
