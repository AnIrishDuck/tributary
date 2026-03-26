# Plan: Editor Image Embedding

Embed images into markdown notes via `![alt](slug)` syntax in the CodeMirror editor, and render them inline when viewing notes.

## Prerequisites

- Image block support (see `plans/images.md`) must be implemented first — specifically Prompt 1 (data layer) and the image add/edit dialog from `scribe-react-img`.
- Tributary blob support (see `plans/blobs.md` at the repo root):
  - Prompt 1 (done): Chunking, encryption, merkle helpers in `tributary-client/src/tributaryBlob.ts`.
  - Prompt 2 (not started): Blob server API — required for downloading image data.
  - Prompt 3 (not started): `TributaryBlob` class with `download(rootHash)` — required for on-demand blob fetching in the `BlobImage` component.

## Design Decisions

- **Linking**: Images are referenced in markdown as `![alt](slug)`. The slug resolves to an image block, which stores the blob hash.
- **Fetching**: On-demand — images load when a note referencing the slug is viewed.
- **Editor insertion**: A toolbar button or drag-and-drop inserts the `![alt](slug)` syntax at the cursor position.

---

## Prompt 1: Markdown Image Resolution + Rendering

**Goal**: Resolve `![alt](slug)` references to blob URLs when rendering markdown, and display image blocks directly when navigated to.

### Files to modify
- **Modify** `apps/scribe/scribe-react-common/src/utils/markdown.ts` — Process `<img src="...">` tags in rendered HTML. If the src is a slug (no protocol), resolve it to a blob URL.
- **Create** `apps/scribe/scribe-react-common/src/utils/blobUrl.ts` — Helper to construct blob fetch URLs from a blob hash.
- **Modify** `apps/scribe/scribe-react-listing/src/pages/SlugViewPage.tsx` — When slug resolution yields a `scribe/image` block, render the image directly instead of markdown.

### What to implement
- **Markdown image resolution**: In `resolveSlugLinksInHtml`, also process `<img src="...">` tags. If the src is a slug link (no protocol), resolve it to a blob URL like `/api/blob/{blobHash}/chunk/0` (or a client-side blob fetch URL).
- **Image block display**: When `SlugViewPage` resolves to a `scribe/image` block, render the image directly instead of markdown. Show the image title, slug breadcrumbs, and move button.

### Test coverage
- Markdown rendering with image slugs resolves correctly (unit test on `renderMarkdown`)
- Image block body parsing in UI components

### Estimated size: ~250 LOC

---

## Prompt 2: Editor Image Insertion

**Goal**: Add image insertion UI to the CodeMirror editor — insert `![alt](slug)` at the cursor.

### Files to modify
- **Modify** `apps/scribe/scribe-react-note/src/pages/EditorPage.tsx` — Add image insert button to the editor toolbar
- **Create** `apps/scribe/scribe-react-note/src/components/ImageInsertPicker.tsx` — Slug picker dialog for choosing an existing image to insert

### What to implement
- **Image insert button**: A toolbar button that opens a picker to select an existing image block by slug.
- **Insert at cursor**: On selection, inserts `![title](slug)` at the current cursor position in the CodeMirror editor.
- **Drag and drop**: (stretch) Accept image file drops onto the editor, upload via blob API, create image block, insert reference.

### Test coverage
- Image insert picker renders and selects slugs
- Markdown insertion at cursor position

### Estimated size: ~200 LOC

---

## Prompt 3: On-Demand Blob Fetching + Integration Polish

**Goal**: Wire up on-demand blob fetching so images actually load in the browser, handle loading states, and add integration-level tests.

### Files to modify
- **Create** `apps/scribe/scribe-react-common/src/hooks/useBlob.ts` — React hook for fetching and caching blobs
- **Modify** `apps/scribe/scribe-react-common/src/utils/markdown.ts` — Use blob URLs that trigger the hook
- **Create** `apps/scribe/scribe-react-common/src/components/BlobImage.tsx` — Component that uses `useBlob` to load and display images

### What to implement
- `useBlob(rootHash: string)` hook: fetches blob via `downloadBlob()`, caches in memory, returns `{ data: Uint8Array | null, loading: boolean, error: Error | null, objectUrl: string | null }`
- `BlobImage` component: takes `rootHash`, `alt`, `width`, `height`. Shows loading placeholder, then the image via object URL. Cleans up object URL on unmount.
- Post-process rendered markdown HTML: replace `<img src="blob:{hash}">` with React `BlobImage` component mounting points.

### Test coverage
- `useBlob` hook tests with fake server
- BlobImage renders loading state and final image
- Integration: create image block, render markdown referencing it, verify image loads

### Estimated size: ~300 LOC

---

## Verification

After all prompts are complete:
1. `make build-all` — everything compiles
2. `make test` — all existing + new tests pass
3. Manual test flow:
   - Create a note with markdown text
   - Insert an image reference via the editor toolbar
   - View the note — image renders inline via `![alt](slug)` syntax
   - Navigate directly to the image slug — see the image displayed
   - Verify blob is fetched on-demand and cached

## Key Files Reference
- `apps/scribe/scribe-react-common/src/utils/markdown.ts` — markdown rendering to extend
- `apps/scribe/scribe-react-note/src/pages/EditorPage.tsx` — editor to add insertion UI
- `apps/scribe/scribe-react-listing/src/pages/SlugViewPage.tsx` — slug routing to extend for image blocks
