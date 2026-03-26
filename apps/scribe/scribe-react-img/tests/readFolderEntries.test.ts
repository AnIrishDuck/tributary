import { describe, it, expect } from 'vitest'
import { readDroppedItems } from '../src/utils/readFolderEntries'

/**
 * Fakes for the FileSystem API used by readDroppedItems.
 * These are minimal implementations that satisfy the browser interfaces
 * without mocking.
 */

function fakeFileEntry(name: string, file: File): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: () => {},
    file: (cb: (f: File) => void) => cb(file),
  } as FileSystemFileEntry
}

function fakeDirEntry(name: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: () => {},
    createReader: () => {
      let read = false
      return {
        readEntries: (cb: (entries: FileSystemEntry[]) => void) => {
          if (!read) {
            read = true
            cb(children)
          } else {
            cb([])
          }
        },
      } as FileSystemDirectoryReader
    },
  } as FileSystemDirectoryEntry
}

function fakeDataTransfer(entries: FileSystemEntry[]): DataTransfer {
  const items = entries.map((entry) => ({
    webkitGetAsEntry: () => entry,
  }))
  return {
    items: {
      length: items.length,
      [Symbol.iterator]: function* () { yield* items },
      ...Object.fromEntries(items.map((item, i) => [i, item])),
    },
  } as unknown as DataTransfer
}

describe('readDroppedItems', () => {
  it('reads a single dropped image file', async () => {
    const file = new File([new Uint8Array(4)], 'photo.png', { type: 'image/png' })
    const dt = fakeDataTransfer([fakeFileEntry('photo.png', file)])

    const results = await readDroppedItems(dt)

    expect(results).toHaveLength(1)
    expect(results[0].file).toBe(file)
    expect(results[0].relativePath).toBe('photo.png')
    expect(results[0].folderPath).toBe('')
  })

  it('filters out non-image files', async () => {
    const img = new File([new Uint8Array(4)], 'photo.png', { type: 'image/png' })
    const txt = new File([new Uint8Array(4)], 'notes.txt', { type: 'text/plain' })
    const dt = fakeDataTransfer([
      fakeFileEntry('photo.png', img),
      fakeFileEntry('notes.txt', txt),
    ])

    const results = await readDroppedItems(dt)

    expect(results).toHaveLength(1)
    expect(results[0].file.name).toBe('photo.png')
  })

  it('recursively reads a folder', async () => {
    const img1 = new File([new Uint8Array(4)], 'a.jpg', { type: 'image/jpeg' })
    const img2 = new File([new Uint8Array(4)], 'b.png', { type: 'image/png' })
    const dir = fakeDirEntry('vacation', [
      fakeFileEntry('a.jpg', img1),
      fakeFileEntry('b.png', img2),
    ])
    const dt = fakeDataTransfer([dir])

    const results = await readDroppedItems(dt)

    expect(results).toHaveLength(2)
    expect(results[0].relativePath).toBe('vacation/a.jpg')
    expect(results[0].folderPath).toBe('vacation')
    expect(results[1].relativePath).toBe('vacation/b.png')
  })

  it('reads nested folders', async () => {
    const img = new File([new Uint8Array(4)], 'deep.png', { type: 'image/png' })
    const inner = fakeDirEntry('inner', [fakeFileEntry('deep.png', img)])
    const outer = fakeDirEntry('outer', [inner])
    const dt = fakeDataTransfer([outer])

    const results = await readDroppedItems(dt)

    expect(results).toHaveLength(1)
    expect(results[0].relativePath).toBe('outer/inner/deep.png')
    expect(results[0].folderPath).toBe('outer/inner')
  })

  it('handles mixed files and folders', async () => {
    const rootImg = new File([new Uint8Array(4)], 'root.png', { type: 'image/png' })
    const nestedImg = new File([new Uint8Array(4)], 'nested.jpg', { type: 'image/jpeg' })
    const dir = fakeDirEntry('folder', [fakeFileEntry('nested.jpg', nestedImg)])
    const dt = fakeDataTransfer([
      fakeFileEntry('root.png', rootImg),
      dir,
    ])

    const results = await readDroppedItems(dt)

    expect(results).toHaveLength(2)
    expect(results[0].relativePath).toBe('root.png')
    expect(results[0].folderPath).toBe('')
    expect(results[1].relativePath).toBe('folder/nested.jpg')
    expect(results[1].folderPath).toBe('folder')
  })

  it('handles readEntries batching (>100 entries)', async () => {
    // Fake a directory reader that returns entries in two batches
    const files = Array.from({ length: 3 }, (_, i) => {
      const file = new File([new Uint8Array(4)], `img${i}.png`, { type: 'image/png' })
      return fakeFileEntry(`img${i}.png`, file)
    })

    const batchDir: FileSystemDirectoryEntry = {
      isFile: false,
      isDirectory: true,
      name: 'big',
      fullPath: '/big',
      filesystem: {} as FileSystem,
      getParent: () => {},
      createReader: () => {
        let callCount = 0
        return {
          readEntries: (cb: (entries: FileSystemEntry[]) => void) => {
            if (callCount === 0) {
              callCount++
              cb(files.slice(0, 2))
            } else if (callCount === 1) {
              callCount++
              cb(files.slice(2))
            } else {
              cb([])
            }
          },
        } as FileSystemDirectoryReader
      },
    } as FileSystemDirectoryEntry

    const dt = fakeDataTransfer([batchDir])
    const results = await readDroppedItems(dt)

    expect(results).toHaveLength(3)
  })

  it('returns empty array when no items dropped', async () => {
    const dt = fakeDataTransfer([])
    const results = await readDroppedItems(dt)
    expect(results).toEqual([])
  })
})
