# Bulk Image Upload — UI

## Context

The data layer for bulk image upload is complete in `scribe-data/src/bulkImage.ts`:
- `ensureBulkCollections(stream, plan, inserter)` — creates sub-collections from folder structure
- `createBulkImageBlocks(stream, plan, collectionMap, inserter)` — creates image blocks in bulk
- Types: `BulkUploadPlan`, `BulkCollectionEntry`, `BulkImageEntry`

This task implements the UI: drag a folder onto a collection listing page, see a confirmation dialog, upload with per-row progress.

## Flow

1. User drags a folder onto any collection listing page
2. Browser reads folder recursively via `webkitGetAsEntry()`, filtering to images
3. A confirmation dialog appears listing all images (slug, title, collection)
4. User clicks "Upload"
5. Each row updates with progress (pending → uploading → done)
6. On completion, listing refreshes

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
- Handle browser quirk: `readEntries()` returns max 100 entries, must call repeatedly until empty

### 2. Upload Plan Builder
**New: `scribe-react-img/src/utils/buildUploadPlan.ts`**

```ts
function buildUploadPlan(
  entries: FolderFileEntry[],
  currentCollectionId: string | null
): BulkUploadPlan
```

- Extract unique folder paths from entries
- For each folder: derive title (last path segment) and slug (via `titleToSlug`)
- Sort collections parents-first (shorter paths before longer)
- For each image: derive slug via `fileNameToSlug()` (strip extension + slugify), title from filename
- Returns a `BulkUploadPlan` (type from `scribe-data`)

### 3. Bulk Upload Dialog
**New: `scribe-react-img/src/components/BulkUploadDialog.tsx`**

Modal overlay with two phases:

**Confirmation phase:**
- List of images grouped by collection (subfolder as section header)
- Each row: filename, auto-derived slug, title
- Summary: "X images in Y collections"
- "Upload" + "Cancel" buttons

**Uploading phase:**
- Same list, each row shows status: pending / uploading (spinner) / done (checkmark)
- Upload logic:
  1. Call `ensureBulkCollections()` to create sub-collections
  2. For each image serially:
     - Read file as `Uint8Array`
     - Get dimensions via offscreen `<img>` (same pattern as `ImageDialog.tsx:getImageDimensions`)
     - Upload blob: `stream.blob().upload(fileData)`
     - Call `createImageBlock()` with blobHash
     - Update row status
  3. Single `stream.sync()` + `indexAll()` at the end
- Serial execution (memory safety — each blob is encrypted + chunked)
- "Done" button to dismiss when complete

### 4. Wire Into Listing Page
**Modify: `scribe-react-listing/src/pages/SlugNoteListPage.tsx`**

- Add `onDragOver` / `onDrop` handlers to root `<div>` (line 94)
- On folder drop: `readDroppedItems()` → `buildUploadPlan()` → show `BulkUploadDialog`
- Need: `useTributary()` for stream access, current `collectionId` + `prefix`
- On completion: re-navigate to refresh listing

**Modify: `scribe-react-img/src/index.ts`**
- Export `BulkUploadDialog`, `readDroppedItems`, `buildUploadPlan`

## Key Dependencies

From `scribe-data`:
- `ensureBulkCollections`, `createBulkImageBlocks`, `BulkUploadPlan` from `bulkImage.ts`
- `createImageBlock` from `image.ts`
- `titleToSlug` from `slug.ts`
- `indexAll` from `indexing.ts`

From `tributary-client`:
- `stream.blob().upload()` for encrypted blob upload
- `stream.sync()` for server sync

From `scribe-react-img` (existing):
- `fileNameToSlug()` pattern from `ImageDialog.tsx`
- `getImageDimensions()` pattern from `ImageDialog.tsx`

## Files Summary

| Action | File |
|--------|------|
| New | `scribe-react-img/src/utils/readFolderEntries.ts` |
| New | `scribe-react-img/src/utils/buildUploadPlan.ts` |
| New | `scribe-react-img/src/components/BulkUploadDialog.tsx` |
| Modify | `scribe-react-listing/src/pages/SlugNoteListPage.tsx` |
| Modify | `scribe-react-img/src/index.ts` |
