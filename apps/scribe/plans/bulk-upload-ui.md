# Bulk Image Upload — UI

## Prerequisites

Complete the data-layer task in `bulk-upload-plan-builder.md` first. That task produces:
- `readDroppedItems()` in `scribe-react-img/src/utils/readFolderEntries.ts`
- `buildUploadPlan()` in `scribe-react-img/src/utils/buildUploadPlan.ts`
- Exported from `scribe-react-img/src/index.ts`

Also depends on the already-complete `scribe-data/src/bulkImage.ts`:
- `ensureBulkCollections(stream, plan, inserter)` → creates sub-collections
- `createBulkImageBlocks(stream, plan, collectionMap, inserter)` → creates image blocks
- Types: `BulkUploadPlan`, `BulkCollectionEntry`, `BulkImageEntry`

## Flow

1. User drags a folder onto any collection listing page
2. `readDroppedItems()` reads folder, `buildUploadPlan()` builds the plan
3. A confirmation dialog appears listing all images (slug, title, collection)
4. User clicks "Upload"
5. Each row updates with progress (pending → uploading → done)
6. On completion, listing refreshes

## Implementation

### 1. Bulk Upload Dialog
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

### 2. Wire Into Listing Page
**Modify: `scribe-react-listing/src/pages/SlugNoteListPage.tsx`**

- Add `onDragOver` / `onDrop` handlers to root `<div>` (line 94)
- On folder drop: `readDroppedItems()` → `buildUploadPlan()` → show `BulkUploadDialog`
- Need: `useTributary()` for stream access, current `collectionId` + `prefix`
- On completion: re-navigate to refresh listing

**Modify: `scribe-react-img/src/index.ts`**
- Export `BulkUploadDialog`

## Key Dependencies

From `scribe-data`:
- `ensureBulkCollections`, `createBulkImageBlocks`, `BulkUploadPlan` from `bulkImage.ts`
- `createImageBlock` from `image.ts`
- `indexAll` from `indexing.ts`

From `tributary-client`:
- `stream.blob().upload()` for encrypted blob upload
- `stream.sync()` for server sync

From `scribe-react-img`:
- `readDroppedItems` from `utils/readFolderEntries.ts` (from plan-builder task)
- `buildUploadPlan` from `utils/buildUploadPlan.ts` (from plan-builder task)
- `getImageDimensions()` pattern from `ImageDialog.tsx`

## Files Summary

| Action | File |
|--------|------|
| New | `scribe-react-img/src/components/BulkUploadDialog.tsx` |
| Modify | `scribe-react-listing/src/pages/SlugNoteListPage.tsx` |
| Modify | `scribe-react-img/src/index.ts` |
