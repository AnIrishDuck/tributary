import { describe, it, expect, beforeEach } from 'vitest';
import { PageCache } from '../src/page-cache.js';
import { MemoryBackend } from '../src/memory-backend.js';
import { PAGE_SIZE } from '../src/types.js';

function makePage(fill: number): Uint8Array {
  const buf = new Uint8Array(PAGE_SIZE);
  buf.fill(fill);
  return buf;
}

describe('PageCache', () => {
  let backend: MemoryBackend;
  let cache: PageCache;

  beforeEach(() => {
    backend = new MemoryBackend();
    cache = new PageCache(backend, 4); // small cache for testing eviction
  });

  it('returns null for a page that does not exist', () => {
    expect(cache.get('file1', 0)).toBeNull();
  });

  it('reads a page from the backend on cache miss', () => {
    backend.writePage('file1', 0, makePage(0xaa));
    const page = cache.get('file1', 0);
    expect(page).not.toBeNull();
    expect(page![0]).toBe(0xaa);
    expect(cache.size).toBe(1);
  });

  it('serves subsequent reads from cache (no backend hit)', () => {
    backend.writePage('file1', 0, makePage(0xaa));
    cache.get('file1', 0);

    // Overwrite backend — cache should still return old value.
    backend.writePage('file1', 0, makePage(0xbb));
    const page = cache.get('file1', 0);
    expect(page![0]).toBe(0xaa);
  });

  it('put writes to cache and marks dirty', () => {
    cache.put('file1', 0, makePage(0xcc));
    expect(cache.size).toBe(1);

    // Not yet in backend (dirty, not flushed).
    expect(backend.readPage('file1', 0)).toBeNull();
  });

  it('flush writes dirty pages to backend', () => {
    cache.put('file1', 0, makePage(0xdd));
    cache.put('file1', 1, makePage(0xee));
    cache.flush();

    expect(backend.readPage('file1', 0)![0]).toBe(0xdd);
    expect(backend.readPage('file1', 1)![0]).toBe(0xee);
  });

  it('flush with fileId only flushes that file', () => {
    cache.put('file1', 0, makePage(0x11));
    cache.put('file2', 0, makePage(0x22));
    cache.flush('file1');

    expect(backend.readPage('file1', 0)![0]).toBe(0x11);
    expect(backend.readPage('file2', 0)).toBeNull();
  });

  it('evicts LRU page when cache is full', () => {
    // Fill cache to capacity (4 pages).
    cache.put('f', 0, makePage(0));
    cache.put('f', 1, makePage(1));
    cache.put('f', 2, makePage(2));
    cache.put('f', 3, makePage(3));
    expect(cache.size).toBe(4);

    // Insert a 5th page — should evict page 0 (LRU).
    cache.put('f', 4, makePage(4));
    expect(cache.size).toBe(4);

    // Page 0 was dirty, so it should have been flushed to backend on eviction.
    expect(backend.readPage('f', 0)![0]).toBe(0);
  });

  it('accessing a page promotes it in LRU order', () => {
    cache.put('f', 0, makePage(0));
    cache.put('f', 1, makePage(1));
    cache.put('f', 2, makePage(2));
    cache.put('f', 3, makePage(3));

    // Touch page 0 to promote it.
    cache.get('f', 0);

    // Insert two more — should evict pages 1 and 2 (the LRU ones), not 0.
    cache.put('f', 4, makePage(4));
    cache.put('f', 5, makePage(5));

    // Pages 1 and 2 were evicted (flushed to backend).
    expect(backend.readPage('f', 1)![0]).toBe(1);
    expect(backend.readPage('f', 2)![0]).toBe(2);

    // Page 0 is still in cache — read should return cached value, not backend.
    backend.writePage('f', 0, makePage(0xff));
    expect(cache.get('f', 0)![0]).toBe(0);
  });

  it('invalidate removes all pages for a file', () => {
    cache.put('file1', 0, makePage(1));
    cache.put('file1', 1, makePage(2));
    cache.put('file2', 0, makePage(3));

    cache.invalidate('file1');

    expect(cache.size).toBe(1);
    // file1 pages gone, file2 still there.
    expect(cache.get('file2', 0)![0]).toBe(3);
  });

  it('truncateFile removes pages at or beyond the given count', () => {
    cache.put('f', 0, makePage(0));
    cache.put('f', 1, makePage(1));
    cache.put('f', 2, makePage(2));
    cache.put('f', 3, makePage(3));

    cache.truncateFile('f', 2);

    expect(cache.size).toBe(2);
    expect(cache.get('f', 0)![0]).toBe(0);
    expect(cache.get('f', 1)![0]).toBe(1);
  });

  it('eviction of clean pages does not write to backend', () => {
    // Load pages from backend (clean).
    for (let i = 0; i < 4; i++) {
      backend.writePage('f', i, makePage(i));
      cache.get('f', i);
    }

    // Overwrite backend page 0 to detect if eviction writes.
    backend.writePage('f', 0, makePage(0xff));

    // Insert a new page to trigger eviction of page 0 (clean).
    cache.put('f', 4, makePage(4));

    // Backend page 0 should still be 0xff (not overwritten by eviction).
    expect(backend.readPage('f', 0)![0]).toBe(0xff);
  });

  it('put overwrites existing cached page and marks dirty', () => {
    backend.writePage('f', 0, makePage(0xaa));
    cache.get('f', 0); // load clean

    cache.put('f', 0, makePage(0xbb)); // overwrite
    cache.flush();

    expect(backend.readPage('f', 0)![0]).toBe(0xbb);
  });
});
