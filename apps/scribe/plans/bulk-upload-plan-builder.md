# Bulk Image Upload — Plan Builder (Data Layer)

## Context

The core bulk creation logic is complete in `scribe-data/src/bulkImage.ts` (types + `ensureBulkCollections` + `createBulkImageBlocks`). This task adds the utilities that bridge browser file APIs to that data layer: reading a dropped folder into a file list, and transforming that file list into a `BulkUploadPlan`.

These utilities live in `scribe-react-img` but are pure data transforms (no React components).

## Implementation

### 1. Folder Reading Utility
**New: `scribe-react-img/src/utils/readFolderEntries.ts`**

```ts
interface FolderFileEntry {
  file: File
  relativePath: string   // e.g. "photos/vacation/beach.jpg"
  folderPath: string      // e.g. "photos/vacation"
}

async function readDroppedItems(dataTransfer: DataTransfer): Promise<FolderFileEntry[]>
```

- Use `DataTransferItem.webkitGetAsEntry()` to recursively read dropped folders
- For `FileSystemDirectoryEntry`: call `createReader()` + `readEntries()` recursively
- For `FileSystemFileEntry`: call `.file()` to get File object
- Filter to `file.type.startsWith('image/')` only
- Handle browser quirk: `readEntries()` returns max 100 entries per call, must call repeatedly until empty array returned

### 2. Upload Plan Builder
**New: `scribe-react-img/src/utils/buildUploadPlan.ts`**

```ts
function buildUploadPlan(
  entries: FolderFileEntry[],
  currentCollectionId: string | null
): BulkUploadPlan
```

- Extract unique folder paths from entries (skip `""` — that's the root)
- For each folder: derive title from last path segment, slug via `titleToSlug()`
- Determine `parentFolderPath`: parent directory path, or `null` for top-level folders
- Sort collections parents-first (by path depth / shorter paths first)
- For each image: derive slug via `fileNameToSlug()` (strip extension + slugify), title from filename without extension
- Returns a `BulkUploadPlan` (type from `scribe-data`)

Reuses:
- `titleToSlug()` from `scribe-data/src/slug.ts`
- `fileNameToSlug()` pattern from `scribe-react-img/src/components/ImageDialog.tsx` (strip extension, then `titleToSlug`)
- `BulkUploadPlan`, `BulkCollectionEntry`, `BulkImageEntry` types from `scribe-data/src/bulkImage.ts`

### 3. Exports
**Modify: `scribe-react-img/src/index.ts`**

Export `readDroppedItems`, `buildUploadPlan`, and `FolderFileEntry` type.

## Files Summary

| Action | File |
|--------|------|
| New | `scribe-react-img/src/utils/readFolderEntries.ts` |
| New | `scribe-react-img/src/utils/buildUploadPlan.ts` |
| Modify | `scribe-react-img/src/index.ts` |
