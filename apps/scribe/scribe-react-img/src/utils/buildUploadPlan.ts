import { titleToSlug } from 'scribe-data'
import type { BulkUploadPlan } from 'scribe-data'
import type { FolderFileEntry } from './readFolderEntries.js'

/** Derive a slug from a filename by stripping the extension and slugifying. */
function fileNameToSlug(name: string): string {
  const withoutExt = name.replace(/\.[^.]+$/, '')
  return titleToSlug(withoutExt)
}

/** Derive a display title from a filename by stripping the extension. */
function fileNameToTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

/**
 * Build a BulkUploadPlan from a list of folder file entries.
 *
 * Extracts unique folder paths, creates collection entries sorted
 * parents-first, and creates image entries with slugs derived from filenames.
 */
export function buildUploadPlan(
  entries: FolderFileEntry[],
  currentCollectionId: string | null,
): BulkUploadPlan {
  // DEBUG: log file properties to find mtime
  for (const entry of entries) {
    const f = entry.file
    console.log('[buildUploadPlan] file:', f.name, {
      lastModified: f.lastModified,
      lastModifiedDate: (f as any).lastModifiedDate,
      size: f.size,
      type: f.type,
      allKeys: Object.keys(f),
      proto: Object.getOwnPropertyNames(Object.getPrototypeOf(f)),
    })
  }

  // Sort entries by file modification time (oldest first)
  const sorted = [...entries].sort(
    (a, b) => a.file.lastModified - b.file.lastModified,
  )

  // Extract unique non-empty folder paths, including all intermediate ancestors
  const folderPaths = new Set<string>()
  for (const entry of sorted) {
    if (entry.folderPath !== '') {
      const segments = entry.folderPath.split('/')
      for (let i = 1; i <= segments.length; i++) {
        folderPaths.add(segments.slice(0, i).join('/'))
      }
    }
  }

  // Sort parents-first (shorter paths first = fewer segments = higher in tree)
  const sortedFolders = [...folderPaths].sort(
    (a, b) => a.split('/').length - b.split('/').length,
  )

  const collections = sortedFolders.map((folderPath) => {
    const segments = folderPath.split('/')
    const title = segments[segments.length - 1]
    const slug = titleToSlug(title)
    const parentFolderPath = segments.length > 1
      ? segments.slice(0, -1).join('/')
      : null

    return { folderPath, title, slug, parentFolderPath }
  })

  const images = sorted.map((entry) => ({
    blobHash: '',
    contentType: entry.file.type,
    fileName: entry.file.name,
    slug: fileNameToSlug(entry.file.name),
    title: fileNameToTitle(entry.file.name),
    folderPath: entry.folderPath,
  }))

  return {
    collections,
    images,
    rootCollectionId: currentCollectionId,
  }
}
