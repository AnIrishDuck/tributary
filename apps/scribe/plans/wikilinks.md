# Wikilinks Implementation Plan

## Overview

`[[Title]]` syntax for linking notes by title (not slug), flat across the entire library. Three parts:

- **Part 1: Data layer** — `title_index` table, `rebuildTitleIndex()`, `lookupByTitle()` *(done first)*
- **Part 2: Micromark + HTML resolution** — parsing `[[...]]` syntax, resolving to `&titled` URLs
- **Part 3: Route handler + integration** — `&titled` handler in SlugViewPage, title collision page, CodeMirror extension

## Design Decisions

- **Resolution**: Redirect route at `&titled?t=Title` (like `&edit`, `&library`). Keeps `renderMarkdown()` sync/pure.
- **Pipe syntax**: `[[Title|Display Text]]` supported.
- **Route convention**: `&titled` with `&` prefix, consistent with existing special suffixes.
- **Scope**: Within a single library (not cross-library).
- **Core, not plugin**: Wikilinks are core functionality, wired directly into `renderMarkdown()` and the editor.

---

## Part 2: Micromark + HTML Resolution

### Micromark extension — `scribe-react-common/src/wikilink/syntax.ts`

Micromark syntax + HTML extension:
- `[[` opens, `]]` closes
- Pipe `|` separates title from display text
- Output HTML:
  - `[[Note]]` → `<a href="wikilink:Note" class="wikilink">Note</a>`
  - `[[Note|click]]` → `<a href="wikilink:Note" class="wikilink">click</a>`

Uses `wikilink:` URI scheme as placeholder.

### HTML resolution — `scribe-react-common/src/utils/markdown.ts`

New `resolveWikilinksInHtml()` function:
- Match `<a href="wikilink:...">` tags
- Rewrite to `/#/{routeBase}/&titled?t={encodeURIComponent(title)}`
- Called after `resolveSlugLinksInHtml()` in `renderMarkdown()`

Also: import wikilink micromark extensions directly in `renderMarkdown()` (alongside GFM).

### Tests
- `[[My Note]]` → correct HTML with wikilink scheme
- `[[My Note|click here]]` → pipe syntax works
- Edge cases: empty brackets, single bracket, nested brackets
- `renderMarkdown()` produces correct `&titled?t=` URLs

---

## Part 3: Route Handler + Integration

### `&titled` handler — `scribe-react-listing/src/pages/SlugViewPage.tsx`

In `SlugViewPage`'s `loadContent`:
- When `splatPath === '&titled'`, read `?t=` from search params
- Call `lookupByTitle(localDb, title)`
- 1 result → `navigate(routeCtx.buildPath(result.slug_path))`
- Multiple → render `TitleCollision` component
- 0 → render "not found" page (with option to create note with that title)

New `PageMode` variant: `{ type: 'titled'; title: string; results: TitleLookupResult[] }`

### Title collision page — `scribe-react-listing/src/pages/TitleCollision.tsx`

Disambiguation component (pattern from `SlugCollision.tsx`):
- Header: `Multiple items titled "Title"`
- List matching notes/collections with full slug paths
- Each links to actual slug-based URL

### CodeMirror extension — `scribe-react-common/src/wikilink/codemirror.ts`

CM6 extension:
- Highlights `[[...]]` and `[[...|...]]` syntax
- Bracket markers dimmed, title/display text highlighted

Wire into editor component directly (find where CM extensions are assembled).

### Tests
- `&titled` handler: single result redirects, multiple shows disambiguation, zero shows not found
- Title collision component renders correctly
- End-to-end: create notes, write wikilink, verify navigation
