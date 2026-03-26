export interface FolderFileEntry {
  file: File
  relativePath: string   // e.g. "photos/vacation/beach.jpg"
  folderPath: string      // e.g. "photos/vacation"
}

/**
 * Read all entries from a FileSystemDirectoryReader, handling the browser
 * quirk where readEntries() returns at most 100 entries per call.
 */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const allEntries: FileSystemEntry[] = []

    function readBatch() {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          resolve(allEntries)
        } else {
          allEntries.push(...entries)
          readBatch()
        }
      }, reject)
    }

    readBatch()
  })
}

/**
 * Convert a FileSystemFileEntry to a File wrapped in a promise.
 */
function fileEntryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

/**
 * Recursively traverse a FileSystemEntry and collect all image files.
 */
async function traverseEntry(
  entry: FileSystemEntry,
  basePath: string,
  results: FolderFileEntry[],
): Promise<void> {
  if (entry.isFile) {
    const file = await fileEntryToFile(entry as FileSystemFileEntry)
    if (file.type.startsWith('image/')) {
      const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name
      const folderPath = basePath
      results.push({ file, relativePath, folderPath })
    }
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()
    const children = await readAllEntries(reader)
    const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name
    for (const child of children) {
      await traverseEntry(child, dirPath, results)
    }
  }
}

/**
 * Read all image files from a DataTransfer (e.g. from a drop event),
 * recursively traversing any dropped folders.
 */
export async function readDroppedItems(dataTransfer: DataTransfer): Promise<FolderFileEntry[]> {
  const results: FolderFileEntry[] = []

  for (let i = 0; i < dataTransfer.items.length; i++) {
    const item = dataTransfer.items[i]
    const entry = item.webkitGetAsEntry?.()
    if (entry) {
      await traverseEntry(entry, '', results)
    }
  }

  return results
}
