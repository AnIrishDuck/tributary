# Plan: Image Thumbnails & Progressive Loading

Generate small thumbnails at upload time, display them in collection listings and as placeholders while full images load. Backfill thumbnails for existing images lazily when a collection is viewed.

## Design Decisions

- **Thumbnail size**: 200px on the longest edge, JPEG at quality 0.7. This keeps thumbnails under ~15 KB, well within a single blob chunk.
- **Format**: Always JPEG (via `<canvas>.toBlob('image/jpeg', 0.7)`), regardless of source format. Simple, universally supported, small. PNG alpha is acceptable to lose for thumbnails.
- **Storage**: Each thumbnail is a separate encrypted blob, uploaded via the existing `TributaryBlob.upload()` flow. The thumbnail's `blobHash` is stored alongside the original in `ImageBlockBody.thumbBlobHash`.
- **Schema change**: Add optional `thumbBlobHash?: string` to `ImageBlockBody`. No database migration needed — it is JSON inside the `body` text column. Old images simply lack the field.
- **Backfill**: When a collection listing page loads, any image blocks missing `thumbBlobHash` are backfilled. The full blob is downloaded, a thumbnail is generated client-side, uploaded as a new blob, and the image block is updated with a new version containing the `thumbBlobHash`. This is throttled (one at a time, with a per-session dedup set) to avoid flooding the network.
- **Progressive loading**: `ImageViewPage` loads and displays the thumbnail immediately, then downloads the full blob in the background and swaps it in.
- **Client-side only**: All thumbnail generation uses the browser `Canvas` API. No server-side image processing, no new dependencies.
- **Caching**: A `useBlob` React hook caches downloaded blob data (as object URLs) in a `Map` keyed by `blobHash`, scoped to the React tree lifetime. Prevents redundant downloads when navigating back to a listing or re-rendering.

---

## Prompt 1: Thumbnail Generation Utility + `ImageBlockBody` Extension

**Goal**: Pure utility functions for generating thumbnails from image data using Canvas, and extend `ImageBlockBody` with `thumbBlobHash`.

### Files to modify
- **Modify** `apps/scribe/scribe-data/src/types.ts` — Add `thumbBlobHash?: string` to `ImageBlockBody`
- **Create** `apps/scribe/scribe-react-img/src/utils/thumbnail.ts` — Thumbnail generation utility

### What to implement

**`ImageBlockBody` change** (types.ts):
```ts
export interface ImageBlockBody {
  blobHash: string
  contentType: string
  title?: string
  altText?: string
  width?: number
  height?: number
  fileName?: string
  thumbBlobHash?: string  // NEW: content-address of the thumbnail blob
}
```

**`thumbnail.ts`** — two functions:

```ts
/**
 * Generate a JPEG thumbnail from raw image bytes.
 *
 * Decodes the image via an offscreen <img> + object URL, draws it
 * scaled-down onto a <canvas>, and exports as JPEG. The longest edge
 * is capped at `maxEdge` (default 200px); aspect ratio is preserved.
 *
 * Returns the thumbnail as a Uint8Array (JPEG bytes).
 */
export async function generateThumbnail(
  imageData: Uint8Array,
  contentType: string,
  maxEdge?: number,
): Promise<Uint8Array>

/**
 * Compute the target dimensions for a thumbnail, preserving aspect ratio.
 * Exported for testing.
 */
export function thumbnailDimensions(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number }
```

Implementation notes:
- `generateThumbnail` creates a `Blob` from the input bytes + content type, makes an object URL, loads it into an `Image`, draws onto a `canvas` at the computed dimensions, calls `canvas.toBlob('image/jpeg', 0.7)`, reads the result as `Uint8Array`, and cleans up the object URL.
- `thumbnailDimensions` is a pure function: if both dimensions are already ≤ `maxEdge`, return them unchanged. Otherwise scale so the longest edge equals `maxEdge`.
- Default `maxEdge` is 200.

### Test coverage
- `thumbnailDimensions` correctly scales landscape, portrait, square, and already-small images
- `thumbnailDimensions` preserves aspect ratio (round-trip check)
- `generateThumbnail` produces a valid JPEG `Uint8Array` (check JPEG magic bytes `0xFF 0xD8`) — requires a test environment with Canvas support (jsdom + `canvas` npm package for tests, or skip in CI if unavailable and test `thumbnailDimensions` only)
- `generateThumbnail` output is smaller than input for a non-trivial image
- `ImageBlockBody` type accepts `thumbBlobHash` (compile-time check via a type test)

### Estimated size: ~120 LOC code + ~80 LOC tests

---

## Prompt 2: `useBlob` Cache Hook + `ThumbnailImage` Component

**Goal**: A React hook that downloads and caches blob data as object URLs, and a component that renders a cached blob as an `<img>`.

### Files to create
- **Create** `apps/scribe/scribe-react-common/src/hooks/useBlob.ts` — Blob download + cache hook
- **Create** `apps/scribe/scribe-react-img/src/components/ThumbnailImage.tsx` — Renders a blob hash as an `<img>` with loading state

### What to implement

**`useBlob(blobHash: string | null, stream: TributaryStream | null)`**:
```ts
interface UseBlobResult {
  objectUrl: string | null
  loading: boolean
  error: Error | null
}
```

- Maintains a module-level `Map<string, string>` cache (blobHash → objectUrl). The cache lives outside React state so it persists across component mounts within the same page session.
- On mount (or when `blobHash` changes): if cached, return immediately. Otherwise, download via `stream.blob().download(blobHash)`, create an object URL, cache it, and set state.
- Null `blobHash` returns `{ objectUrl: null, loading: false, error: null }`.
- Cleanup: revoke object URLs when the cache grows beyond a configurable limit (e.g. 200 entries, LRU eviction). This prevents memory leaks in large collections.

**`ThumbnailImage`**:
```tsx
interface ThumbnailImageProps {
  blobHash: string | null
  alt: string
  className?: string
  width?: number
  height?: number
  /** Fallback when no blobHash or while loading */
  fallback?: React.ReactNode
}
```

- Uses `useBlob` internally to resolve the `blobHash` to an object URL.
- Renders the fallback (or a gray placeholder `<div>` with aspect ratio from width/height) while loading.
- Renders `<img src={objectUrl}>` once loaded.
- On error, renders the fallback.

### Test coverage
- `useBlob` returns cached URL on second call with same hash (no duplicate download)
- `useBlob` with null hash returns null URL immediately
- `useBlob` sets error state when download fails
- `ThumbnailImage` renders fallback while loading, then img once resolved
- `ThumbnailImage` renders fallback when blobHash is null

### Estimated size: ~150 LOC code + ~120 LOC tests

---

## Prompt 3: Thumbnail Generation at Upload Time

**Goal**: Wire thumbnail generation into the single-image and bulk-image upload flows, so newly uploaded images have `thumbBlobHash` set.

### Files to modify
- **Modify** `apps/scribe/scribe-react-img/src/actions/saveImage.ts` — Generate and upload thumbnail before creating the image block
- **Modify** `apps/scribe/scribe-react-img/src/components/BulkUploadDialog.tsx` — Generate thumbnail for each image during bulk upload
- **Modify** `apps/scribe/scribe-data/src/image.ts` — Accept `thumbBlobHash` in `createImageBlock` and `createImageBlocks`

### What to implement

**`saveImage.ts` changes**:
After reading the file as `Uint8Array` and before calling `createImageBlock`:
1. Call `generateThumbnail(fileData, contentType)` to get thumbnail bytes
2. Call `blob.upload(thumbBytes)` to get `thumbBlobHash`
3. Pass `thumbBlobHash` to `createImageBlock`

```ts
// In saveImage():
const thumbData = await generateThumbnail(params.fileData, params.contentType)
const thumbBlobHash = await blob.upload(thumbData)

const block = await scribeData.createImageBlock(stream, {
  // ...existing fields...
  thumbBlobHash,
})
```

**`BulkUploadDialog.tsx` changes**:
In the per-image upload loop, after getting `fileData` and before `createImageBlock`:
1. `const thumbData = await generateThumbnail(fileData, contentType)`
2. `const thumbBlobHash = await blob.upload(thumbData)`
3. Include `thumbBlobHash` in the image block creation

**`image.ts` changes**:
- Add `thumbBlobHash?: string` to the `data` parameter of `createImageBlock` and `createImageBlocks`
- Include it in the `ImageBlockBody` JSON serialization

### Test coverage
- `saveImage` produces a block whose body includes `thumbBlobHash` (integration test with `FakeServer`)
- `createImageBlock` with `thumbBlobHash` round-trips through `parseImageBlockBody`
- `createImageBlock` without `thumbBlobHash` still works (backward compat)
- `createImageBlocks` (batch) includes `thumbBlobHash` in each block body

### Estimated size: ~80 LOC code + ~100 LOC tests

---

## Prompt 4: Thumbnail Display in Collection Listings

**Goal**: Show thumbnail previews on image cards in the collection listing page, replacing the generic `PhotoIcon`.

### Files to modify
- **Modify** `apps/scribe/scribe-react-listing/src/pages/SlugNoteListPage.tsx` — Replace `PhotoIcon` with `ThumbnailImage` for image cards
- **Modify** `apps/scribe/scribe-data/src/indexing.ts` — Include `thumbBlobHash` in `NoteSlugRow` for image blocks

### What to implement

**Indexing changes**:
The `NoteSlugRow` type is used to render listing cards. For image blocks, the `thumbBlobHash` needs to be available. Two options:

Option A (preferred): Parse `thumbBlobHash` out of the JSON `body` during indexing and store it in the existing `title` metadata pipeline. Since `NoteSlugRow` already has `block_type`, add an optional `thumb_blob_hash` column to the query that extracts it from the JSON body for image blocks:
```sql
CASE WHEN b.block_type = 'scribe/image'
  THEN (b.body::jsonb ->> 'thumbBlobHash')
  ELSE NULL
END AS thumb_blob_hash
```

Add `thumbBlobHash?: string` to the `NoteSlugRow` type.

**Listing page changes**:
In `SlugNoteListPage.tsx`, for image cards (where `isImage` is true):
- Get the `TributaryStream` from context (already available via `useTributary`)
- Replace the `PhotoIcon` div with `<ThumbnailImage>`:
```tsx
{isImage && note.thumbBlobHash ? (
  <ThumbnailImage
    blobHash={note.thumbBlobHash}
    alt={note.title || 'Image'}
    className="h-10 w-10 rounded-lg object-cover"
    fallback={
      <div className="h-10 w-10 rounded-lg bg-green-50 flex items-center justify-center">
        <PhotoIcon className="w-6 h-6 text-green-600" />
      </div>
    }
  />
) : /* existing icon rendering */ }
```

Images without thumbnails (pre-existing, not yet backfilled) still show the `PhotoIcon` fallback.

### Test coverage
- `NoteSlugRow` query returns `thumbBlobHash` for image blocks that have one
- `NoteSlugRow` query returns null `thumbBlobHash` for image blocks without one
- `NoteSlugRow` query returns null `thumbBlobHash` for markdown blocks
- Listing page renders `ThumbnailImage` for images with thumbBlobHash
- Listing page renders `PhotoIcon` fallback for images without thumbBlobHash

### Estimated size: ~100 LOC code + ~120 LOC tests

---

## Prompt 5: Progressive Loading on `ImageViewPage`

**Goal**: Show the thumbnail immediately when viewing an image, then swap in the full-resolution image once it finishes downloading.

### Files to modify
- **Modify** `apps/scribe/scribe-react-img/src/pages/ImageViewPage.tsx` — Load thumbnail first, then full image

### What to implement

Replace the current single-fetch loading flow with a two-stage approach:

1. **Stage 1 (thumbnail)**: If `body.thumbBlobHash` exists, download the thumbnail blob via `useBlob`. Display it immediately with a CSS blur filter (`filter: blur(4px)`) and scaled up to fill the container, plus a small loading spinner overlay.

2. **Stage 2 (full image)**: Download the full blob in the background (existing `blob.download(body.blobHash)` call). Once ready, swap the `<img>` src to the full-resolution object URL and remove the blur filter. Use a CSS transition for a smooth reveal.

3. **No thumbnail**: If `thumbBlobHash` is absent, fall back to the current behavior (loading spinner → full image).

```tsx
// Pseudocode for the two-stage rendering:
{thumbUrl && !fullUrl && (
  <div className="relative">
    <img
      src={thumbUrl}
      className="max-w-full rounded-lg transition-all duration-300"
      style={{ filter: 'blur(4px)', maxHeight: '70vh', objectFit: 'contain' }}
    />
    <div className="absolute inset-0 flex items-center justify-center">
      <Spinner />
    </div>
  </div>
)}
{fullUrl && (
  <img
    src={fullUrl}
    className="max-w-full rounded-lg"
    style={{ maxHeight: '70vh', objectFit: 'contain' }}
  />
)}
```

### Test coverage
- ImageViewPage with thumbBlobHash renders thumbnail first, then full image
- ImageViewPage without thumbBlobHash shows spinner then full image (existing behavior)
- Thumbnail img has blur filter class
- Full image replaces thumbnail once loaded

### Estimated size: ~80 LOC code + ~80 LOC tests

---

## Prompt 6: Backfill Thumbnails for Existing Images

**Goal**: When viewing a collection, detect image blocks missing `thumbBlobHash` and generate thumbnails in the background.

### Files to create/modify
- **Create** `apps/scribe/scribe-react-img/src/hooks/useThumbnailBackfill.ts` — Hook that backfills thumbnails for a list of image blocks
- **Modify** `apps/scribe/scribe-react-listing/src/pages/SlugNoteListPage.tsx` — Call the backfill hook when the listing loads
- **Modify** `apps/scribe/scribe-data/src/image.ts` — Add `updateImageBlockThumbnail` helper for setting just the thumbBlobHash

### What to implement

**`useThumbnailBackfill(images, stream)`** hook:
```ts
interface BackfillableImage {
  blockUuid: string
  blobHash: string
  contentType: string
  thumbBlobHash?: string
}

/**
 * Backfill thumbnails for image blocks that are missing them.
 * Processes one image at a time in the background. Skips images
 * that already have a thumbBlobHash. Deduplicates within the
 * current session to avoid re-processing on re-renders.
 *
 * Returns { backfilling: boolean, backfilledCount: number }.
 */
export function useThumbnailBackfill(
  images: BackfillableImage[],
  stream: TributaryStream | null,
  inserter?: string,
): { backfilling: boolean; backfilledCount: number }
```

Implementation:
1. Filter to images where `thumbBlobHash` is falsy
2. Maintain a module-level `Set<string>` of block UUIDs already processed (or in-progress) this session — prevents duplicate work on re-renders or re-navigation
3. Process one at a time via `useEffect`:
   a. Download the full blob: `stream.blob().download(blobHash)`
   b. Generate thumbnail: `generateThumbnail(data, contentType)`
   c. Upload thumbnail blob: `stream.blob().upload(thumbData)`
   d. Update the image block: `updateImageBlockThumbnail(stream, blockUuid, thumbBlobHash, inserter)`
   e. Sync: `stream.sync()`
   f. Re-index: `indexAll(stream.local())`
4. If any step fails for one image, log the error and continue to the next
5. Track progress in state: `backfilling` (boolean), `backfilledCount` (number)

**`updateImageBlockThumbnail`** (image.ts):
```ts
export async function updateImageBlockThumbnail(
  db: TributaryStream,
  blockUuid: string,
  thumbBlobHash: string,
  inserter: string,
): Promise<Note>
```
- Reads the current image block body, adds `thumbBlobHash`, creates a new version via `createNoteVersion`. This is a thin wrapper around `updateImageBlock` that only sets the `thumbBlobHash` field.

**`SlugNoteListPage.tsx` changes**:
- Extract image blocks from `notes` (where `block_type === 'scribe/image'`), parse their bodies to get `blobHash` and `thumbBlobHash`
- Pass them to `useThumbnailBackfill(images, stream)`
- Optionally show a subtle indicator when backfilling is active (e.g. a small progress badge)

### Test coverage
- `useThumbnailBackfill` skips images that already have `thumbBlobHash`
- `useThumbnailBackfill` processes images missing `thumbBlobHash` and updates them
- `useThumbnailBackfill` deduplicates within a session (calling twice with same images doesn't re-process)
- `useThumbnailBackfill` continues to next image on failure
- `updateImageBlockThumbnail` creates a new version with `thumbBlobHash` set, preserving other fields
- Integration: create an image block without thumbBlobHash, run backfill, verify thumbBlobHash is now set

### Estimated size: ~200 LOC code + ~180 LOC tests

---

## Verification

After all prompts are complete:
1. `make build-all` — everything compiles
2. `make test` — all existing + new tests pass
3. Manual test flow:
   - Upload a new image → verify `thumbBlobHash` is set in the block body
   - View collection listing → image cards show thumbnail previews instead of generic icon
   - Navigate to an image → thumbnail appears immediately (blurred), full image loads and replaces it
   - Upload images via bulk upload → all have thumbnails
   - View a collection with pre-existing images (no thumbnails) → backfill runs in background, thumbnails appear after a moment
   - Re-navigate to the same collection → backfilled images show thumbnails immediately, no re-processing
   - Verify old images without thumbnails gracefully fall back to `PhotoIcon` in listings and spinner in view page

## Key Files Reference
- `apps/scribe/scribe-data/src/types.ts` — `ImageBlockBody` to extend with `thumbBlobHash`
- `apps/scribe/scribe-data/src/image.ts` — Image block CRUD (createImageBlock, updateImageBlock, parseImageBlockBody)
- `apps/scribe/scribe-react-img/src/actions/saveImage.ts` — Single image upload flow to hook into
- `apps/scribe/scribe-react-img/src/components/BulkUploadDialog.tsx` — Bulk upload flow to hook into
- `apps/scribe/scribe-react-img/src/pages/ImageViewPage.tsx` — Full image view to add progressive loading
- `apps/scribe/scribe-react-listing/src/pages/SlugNoteListPage.tsx` — Collection listing to add thumbnails
- `apps/scribe/scribe-data/src/indexing.ts` — Indexing queries to expose `thumbBlobHash`
- `tributary-client/src/tributaryBlob.ts` — Blob upload/download (used as-is, no changes)
- `tributary-client/src/fakeServer.ts` — Fake blob server for testing
