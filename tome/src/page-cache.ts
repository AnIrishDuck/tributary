import { CachePage, PAGE_SIZE, StorageBackend } from './types.js';

/**
 * Bounded LRU page cache with dirty tracking.
 *
 * Pages are keyed by `${fileId}\0${pageIndex}`. A doubly-linked list
 * (via Map insertion order) tracks LRU ordering — accessing a page
 * moves it to the end (most-recently-used). When the cache is full,
 * the oldest entry is evicted; if it is dirty it is flushed first.
 */
export class PageCache {
  /** Max pages held in memory. */
  readonly maxPages: number;

  /**
   * Map preserving insertion order for LRU.
   * Accessing a key deletes + re-inserts it to move it to the tail.
   */
  private pages = new Map<string, CachePage>();

  private backend: StorageBackend;

  constructor(backend: StorageBackend, maxPages = 4096) {
    this.backend = backend;
    this.maxPages = maxPages;
  }

  // ── public API ────────────────────────────────────────────────

  /** Number of pages currently cached. */
  get size(): number {
    return this.pages.size;
  }

  /**
   * Get a page. Returns the cached buffer or loads from the backend
   * on a cache miss. Returns null only if the backend has no such page.
   */
  get(fileId: string, pageIndex: number): Uint8Array | null {
    const key = pageKey(fileId, pageIndex);
    const cached = this.pages.get(key);
    if (cached) {
      this.touch(key, cached);
      return cached.data;
    }

    // Cache miss — load from backend.
    const data = this.backend.readPage(fileId, pageIndex);
    if (data === null) return null;

    this.insert(fileId, pageIndex, data, false);
    return data;
  }

  /**
   * Write a page into the cache and mark it dirty.
   * The page will be flushed to the backend on eviction or explicit flush.
   */
  put(fileId: string, pageIndex: number, data: Uint8Array): void {
    const key = pageKey(fileId, pageIndex);
    const existing = this.pages.get(key);
    if (existing) {
      existing.data = data;
      existing.dirty = true;
      this.touch(key, existing);
      return;
    }
    this.insert(fileId, pageIndex, data, true);
  }

  /**
   * Flush all dirty pages for a specific file (or all files if fileId
   * is omitted) to the backend in a single batch write.
   */
  flush(fileId?: string): void {
    const batch: Array<{
      fileId: string;
      pageIndex: number;
      data: Uint8Array;
    }> = [];
    for (const page of this.pages.values()) {
      if (!page.dirty) continue;
      if (fileId !== undefined && page.fileId !== fileId) continue;
      batch.push({
        fileId: page.fileId,
        pageIndex: page.pageIndex,
        data: page.data,
      });
      page.dirty = false;
    }
    if (batch.length > 0) {
      this.backend.writePages(batch);
    }
  }

  /** Remove all cached pages for a file (e.g. on delete/rename). */
  invalidate(fileId: string): void {
    const toDelete: string[] = [];
    for (const [key, page] of this.pages) {
      if (page.fileId === fileId) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this.pages.delete(key);
    }
  }

  /** Remove all cached pages beyond `newPageCount` for a file (truncation). */
  truncateFile(fileId: string, newPageCount: number): void {
    const toDelete: string[] = [];
    for (const [key, page] of this.pages) {
      if (page.fileId === fileId && page.pageIndex >= newPageCount) {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) {
      this.pages.delete(key);
    }
  }

  // ── internals ─────────────────────────────────────────────────

  /** Move a page to the most-recently-used position. */
  private touch(key: string, page: CachePage): void {
    this.pages.delete(key);
    this.pages.set(key, page);
  }

  /** Insert a new page, evicting the LRU entry if at capacity. */
  private insert(
    fileId: string,
    pageIndex: number,
    data: Uint8Array,
    dirty: boolean,
  ): void {
    if (this.pages.size >= this.maxPages) {
      this.evict();
    }
    const key = pageKey(fileId, pageIndex);
    this.pages.set(key, { fileId, pageIndex, data, dirty });
  }

  /** Evict the least-recently-used page. Flush if dirty. */
  private evict(): void {
    // Map iterator yields in insertion order — first entry is LRU.
    const first = this.pages.entries().next();
    if (first.done) return;
    const [key, page] = first.value;
    if (page.dirty) {
      this.backend.writePage(page.fileId, page.pageIndex, page.data);
    }
    this.pages.delete(key);
  }
}

function pageKey(fileId: string, pageIndex: number): string {
  return `${fileId}\0${pageIndex}`;
}
