import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryBackend } from '../src/memory-backend.js';
import { PAGE_SIZE } from '../src/types.js';

function makePage(fill: number): Uint8Array {
  const buf = new Uint8Array(PAGE_SIZE);
  buf.fill(fill);
  return buf;
}

describe('MemoryBackend', () => {
  let backend: MemoryBackend;

  beforeEach(() => {
    backend = new MemoryBackend();
  });

  it('readPage returns null for nonexistent page', () => {
    expect(backend.readPage('f', 0)).toBeNull();
  });

  it('writePage + readPage round-trips', () => {
    backend.writePage('f', 0, makePage(0x42));
    expect(backend.readPage('f', 0)![0]).toBe(0x42);
  });

  it('writePages writes multiple pages atomically', () => {
    backend.writePages([
      { fileId: 'f', pageIndex: 0, data: makePage(1) },
      { fileId: 'f', pageIndex: 1, data: makePage(2) },
      { fileId: 'g', pageIndex: 0, data: makePage(3) },
    ]);
    expect(backend.readPage('f', 0)![0]).toBe(1);
    expect(backend.readPage('f', 1)![0]).toBe(2);
    expect(backend.readPage('g', 0)![0]).toBe(3);
  });

  it('file metadata round-trips', () => {
    backend.setFileMeta('f', {
      size: 1024,
      mode: 0o644,
      ctime: 1000,
      mtime: 2000,
      isDir: false,
    });
    const meta = backend.getFileMeta('f');
    expect(meta).toEqual({
      size: 1024,
      mode: 0o644,
      ctime: 1000,
      mtime: 2000,
      isDir: false,
    });
  });

  it('getFileMeta returns null for nonexistent file', () => {
    expect(backend.getFileMeta('nope')).toBeNull();
  });

  it('deleteFile removes metadata and all pages', () => {
    backend.setFileMeta('f', {
      size: 0,
      mode: 0o644,
      ctime: 0,
      mtime: 0,
      isDir: false,
    });
    backend.writePage('f', 0, makePage(1));
    backend.writePage('f', 1, makePage(2));

    backend.deleteFile('f');

    expect(backend.getFileMeta('f')).toBeNull();
    expect(backend.readPage('f', 0)).toBeNull();
    expect(backend.readPage('f', 1)).toBeNull();
  });

  it('listFiles returns files matching prefix', () => {
    backend.setFileMeta('/data/a', {
      size: 0,
      mode: 0o644,
      ctime: 0,
      mtime: 0,
      isDir: false,
    });
    backend.setFileMeta('/data/b', {
      size: 0,
      mode: 0o644,
      ctime: 0,
      mtime: 0,
      isDir: false,
    });
    backend.setFileMeta('/other/c', {
      size: 0,
      mode: 0o644,
      ctime: 0,
      mtime: 0,
      isDir: false,
    });

    const files = backend.listFiles('/data/');
    expect(files.sort()).toEqual(['/data/a', '/data/b']);
  });

  it('renameFile moves metadata and pages', () => {
    backend.setFileMeta('old', {
      size: 100,
      mode: 0o644,
      ctime: 0,
      mtime: 0,
      isDir: false,
    });
    backend.writePage('old', 0, makePage(0xaa));
    backend.writePage('old', 1, makePage(0xbb));

    backend.renameFile('old', 'new');

    expect(backend.getFileMeta('old')).toBeNull();
    expect(backend.readPage('old', 0)).toBeNull();
    expect(backend.getFileMeta('new')!.size).toBe(100);
    expect(backend.readPage('new', 0)![0]).toBe(0xaa);
    expect(backend.readPage('new', 1)![0]).toBe(0xbb);
  });
});
