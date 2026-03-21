# Scribe Plugin System Design

## Problem

Different libraries need different capabilities:

- A recipe library wants a "keep screen on" mode to prevent mobile timeouts while cooking
- A music library wants an interactive guitar tab editor (a full React component)
- A math library wants LaTeX rendering in markdown

These behaviors should be activatable **per-library**, developed **outside the core codebase** (separate npm packages or repos), and composed together.

## Plugin Interface

A plugin is a plain object conforming to `ScribePlugin`:

```typescript
// scribe-react-common/src/plugins/types.ts

import { Extension as MicromarkExtension } from 'micromark-util-types'
import { HtmlExtension as MicromarkHtmlExtension } from 'micromark-util-types'
import { Extension as CmExtension } from '@codemirror/state'
import { ComponentType, ReactNode } from 'react'

export const SCRIBE_PLUGIN_API_VERSION = 1

export interface ScribePlugin {
  /** Unique identifier, e.g. "math", "guitar-tabs", "wake-lock" */
  name: string

  /**
   * The plugin API version this plugin targets.
   * Must match SCRIBE_PLUGIN_API_VERSION at runtime.
   */
  apiVersion: typeof SCRIBE_PLUGIN_API_VERSION

  /**
   * Micromark syntax + HTML extensions.
   * These get merged into the micromark() call alongside GFM.
   */
  micromark?: {
    extensions?: MicromarkExtension[]
    htmlExtensions?: MicromarkHtmlExtension[]
  }

  /**
   * CodeMirror extensions for the editor (e.g. syntax highlighting
   * for custom blocks, a custom keymap, etc.)
   */
  codemirror?: CmExtension[]

  /**
   * Post-process rendered HTML before it's inserted into the DOM.
   * Runs after micromark + link resolution. Useful for finding
   * placeholder elements and enriching them, or adding attributes.
   *
   * Transforms are composed in plugin order (output of one feeds into the next).
   */
  transformHtml?: (html: string) => string

  /**
   * Mount interactive React components into rendered HTML.
   *
   * After the markdown HTML is inserted into the DOM, the runtime queries
   * for elements matching `selector` and renders `Component` into each one.
   * The element's dataset attributes are passed as props.
   *
   * Example: a plugin's micromark extension emits
   *   <div data-plugin="guitar-tabs" data-content="..."></div>
   * and this mount replaces it with the full React tab editor.
   */
  mounts?: Array<{
    selector: string
    Component: ComponentType<{ element: HTMLElement }>
  }>

  /**
   * A React component rendered (invisibly) when this plugin's library is
   * active. Use for side effects: wake lock, keyboard shortcuts, analytics,
   * registering service workers, etc.
   *
   * Receives no props. Unmounted when navigating away from the library.
   */
  Effect?: ComponentType
}
```

### Why this shape?

| Scenario | Which fields | How it works |
|---|---|---|
| Keep screen on | `Effect` | Renders a `<WakeLockEffect>` that calls `navigator.wakeLock.request('screen')` on mount and releases on unmount |
| Guitar tab editor | `micromark` + `mounts` | A micromark extension parses `` ```tabs `` fenced code blocks into `<div data-plugin="guitar-tabs" data-tab="...">` placeholder elements; `mounts` finds those divs and renders the React tab editor into each |
| Math rendering | `micromark` + `transformHtml` *or* `mounts` | A micromark extension parses `$...$` / `$$...$$` into `<span data-math="...">` placeholders; either `transformHtml` calls KaTeX's `renderToString` to produce static HTML, or `mounts` renders a React KaTeX component |

All three use the same plugin shape. A plugin can use any combination of fields.

## Per-Library Activation

### Option A: Registration at app initialization (recommended)

The host app (scribe-react) declares which plugins are available and which libraries use them. This is explicit and requires no schema changes:

```typescript
// scribe-react/src/plugins.ts
import { wakeLock } from 'scribe-plugin-wake-lock'
import { guitarTabs } from 'scribe-plugin-guitar-tabs'
import { math } from 'scribe-plugin-math'

/**
 * Map of stream prefix → plugins enabled for that library.
 * A plugin listed here is active whenever the user is viewing
 * or editing a note in the corresponding library.
 */
export const libraryPlugins: Record<string, ScribePlugin[]> = {
  [RECIPES_STREAM_PREFIX]: [wakeLock],
  [MUSIC_STREAM_PREFIX]:   [guitarTabs],
  [MATH_STREAM_PREFIX]:    [math],
}

// Plugins enabled for ALL libraries (e.g. global shortcuts):
export const globalPlugins: ScribePlugin[] = []
```

### Option B: Stored in library metadata (future)

Later, plugins could be declared in a library's metadata (a well-known note, or a new `library_config` table). This allows non-developer users to toggle plugins. The runtime resolution is the same — it just reads the plugin list from the DB instead of a static map.

We recommend starting with Option A. It's simpler, avoids schema changes, and the migration path to Option B is straightforward.

## Runtime Integration

### 1. Plugin Context

A new React context makes the active plugins available to all components:

```typescript
// scribe-react-common/src/context/pluginContext.tsx
import { createContext, useContext, useMemo } from 'react'
import { ScribePlugin } from '../plugins/types'

const PluginContext = createContext<ScribePlugin[]>([])

export function PluginProvider({
  plugins,
  children,
}: {
  plugins: ScribePlugin[]
  children: ReactNode
}) {
  return (
    <PluginContext.Provider value={plugins}>
      {children}
    </PluginContext.Provider>
  )
}

export function usePlugins(): ScribePlugin[] {
  return useContext(PluginContext)
}
```

The `PluginProvider` wraps each library's route subtree. The `PkRouteWrapper` / `NamedRouteResolver` components already know the `prefix`, so they look up `libraryPlugins[prefix]` and wrap children:

```tsx
// in PkRouteWrapper / NamedRouteResolver
const plugins = [
  ...globalPlugins,
  ...(libraryPlugins[prefix] ?? []),
]

return (
  <PluginProvider plugins={plugins}>
    <RouteContextProvider ...>
      <Outlet />
    </RouteContextProvider>
  </PluginProvider>
)
```

### 2. Markdown Rendering (micromark extensions + transformHtml)

`renderMarkdown` gains a `plugins` parameter:

```typescript
export function renderMarkdown(
  content: string,
  streamPrefix: string,
  currentSlug?: string,
  routeBase?: string,
  plugins?: ScribePlugin[]
): string {
  const extraExtensions = (plugins ?? []).flatMap(p => p.micromark?.extensions ?? [])
  const extraHtmlExtensions = (plugins ?? []).flatMap(p => p.micromark?.htmlExtensions ?? [])

  let html = micromark(content, {
    extensions: [gfm(), ...extraExtensions],
    htmlExtensions: [gfmHtml(), ...extraHtmlExtensions],
  })

  html = resolveSlugLinksInHtml(html, streamPrefix, currentSlug, routeBase)

  for (const plugin of plugins ?? []) {
    if (plugin.transformHtml) {
      html = plugin.transformHtml(html)
    }
  }

  return html
}
```

Call sites (`NoteViewPage`, `EditorPage` preview) pass `usePlugins()` through.

### 3. React Mounts (interactive components in rendered HTML)

After the markdown HTML is inserted into the DOM, a hook processes `mounts`:

```typescript
// scribe-react-common/src/plugins/useMountPlugins.ts
import { useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { ScribePlugin } from './types'

export function useMountPlugins(
  containerRef: RefObject<HTMLElement | null>,
  plugins: ScribePlugin[]
) {
  const rootsRef = useRef<Map<Element, ReturnType<typeof createRoot>>>(new Map())

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const roots = rootsRef.current

    for (const plugin of plugins) {
      for (const mount of plugin.mounts ?? []) {
        const targets = container.querySelectorAll(mount.selector)
        targets.forEach((el) => {
          if (!roots.has(el)) {
            const root = createRoot(el)
            root.render(<mount.Component element={el as HTMLElement} />)
            roots.set(el, root)
          }
        })
      }
    }

    return () => {
      roots.forEach((root) => root.unmount())
      roots.clear()
    }
  }, [containerRef, plugins])
}
```

`NoteViewPage` uses it:

```tsx
const plugins = usePlugins()
const proseRef = useRef<HTMLDivElement>(null)

// After render:
useMountPlugins(proseRef, plugins)

return (
  <div
    ref={proseRef}
    className="prose prose-lg max-w-none"
    dangerouslySetInnerHTML={{ __html: renderMarkdown(content, prefix, splatPath, routeBase, plugins) }}
  />
)
```

### 4. Effect Components (side effects)

Rendered inside the `PluginProvider`:

```tsx
export function PluginProvider({ plugins, children }: { ... }) {
  return (
    <PluginContext.Provider value={plugins}>
      {plugins.map((p) =>
        p.Effect ? <p.Effect key={p.name} /> : null
      )}
      {children}
    </PluginContext.Provider>
  )
}
```

Effect components mount when you enter a library and unmount when you leave. Standard React lifecycle.

### 5. CodeMirror Extensions

`EditorPage` merges plugin CodeMirror extensions into its editor setup:

```typescript
const plugins = usePlugins()
const pluginExtensions = plugins.flatMap(p => p.codemirror ?? [])

// In the CodeMirror EditorState.create or reconfigure:
extensions: [
  markdown(),
  ...pluginExtensions,
  // ... existing extensions
]
```

## Example: Wake Lock Plugin

A complete plugin in its own package:

```typescript
// packages/scribe-plugin-wake-lock/src/index.ts
import { useEffect } from 'react'
import { ScribePlugin } from 'scribe-react-common/src/plugins/types'

function WakeLockEffect() {
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null

    async function acquire() {
      try {
        sentinel = await navigator.wakeLock.request('screen')
      } catch {
        // Wake Lock API not supported or permission denied
      }
    }

    acquire()

    // Re-acquire on visibility change (released automatically when tab hidden)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      sentinel?.release()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return null
}

export const wakeLock: ScribePlugin = {
  name: 'wake-lock',
  apiVersion: 1,
  Effect: WakeLockEffect,
}
```

## Example: Guitar Tab Editor Plugin

```typescript
// packages/scribe-plugin-guitar-tabs/src/index.ts
import { ScribePlugin } from 'scribe-react-common/src/plugins/types'
import { tabsSyntax, tabsHtml } from './micromark-tabs'
import { TabEditor } from './TabEditor' // full React component

export const guitarTabs: ScribePlugin = {
  name: 'guitar-tabs',
  apiVersion: 1,

  micromark: {
    // Parse ```tabs fenced code blocks into <div data-plugin-tabs data-content="...">
    extensions: [tabsSyntax()],
    htmlExtensions: [tabsHtml()],
  },

  mounts: [
    {
      selector: '[data-plugin-tabs]',
      Component: ({ element }) => {
        const content = element.getAttribute('data-content') ?? ''
        return <TabEditor initialContent={content} />
      },
    },
  ],
}
```

## Example: Math Rendering Plugin

```typescript
// packages/scribe-plugin-math/src/index.ts
import { math as mathSyntax, mathHtml } from 'micromark-extension-math'
import katex from 'katex'
import { ScribePlugin } from 'scribe-react-common/src/plugins/types'

export const math: ScribePlugin = {
  name: 'math',
  apiVersion: 1,

  micromark: {
    extensions: [mathSyntax()],
    htmlExtensions: [mathHtml({ renderToString: katex.renderToString })],
  },
}
```

This one doesn't even need `mounts` or `transformHtml` — the existing `micromark-extension-math` package does everything at the micromark level.

## Developer Experience

### Creating a new plugin

1. Create a new package (in-monorepo or external repo)
2. Add `scribe-react-common` as a peer dependency (for the `ScribePlugin` type)
3. Export a `ScribePlugin` object
4. Register it in `scribe-react/src/plugins.ts`

### Local development

Since the monorepo uses npm workspaces, an in-repo plugin at `apps/scribe/scribe-plugin-foo/` is immediately available to `scribe-react` with no build step. External plugins can use `npm link` or workspace references.

### Testing plugins in isolation

A plugin is a plain object — its individual pieces are independently testable:
- Micromark extensions: test input markdown → output HTML
- React components: render with React Testing Library
- Effects: test with standard React hook testing

## Changes Required

Summary of files to touch:

| File | Change |
|---|---|
| `scribe-react-common/src/plugins/types.ts` | **New.** `ScribePlugin` interface |
| `scribe-react-common/src/context/pluginContext.tsx` | **New.** `PluginProvider` + `usePlugins` |
| `scribe-react-common/src/plugins/useMountPlugins.ts` | **New.** Hook for mounting React components into rendered HTML |
| `scribe-react-common/src/utils/markdown.ts` | Extend `renderMarkdown` to accept plugins |
| `scribe-react-note/src/pages/NoteViewPage.tsx` | Pass plugins to `renderMarkdown`, use `useMountPlugins` |
| `scribe-react-note/src/pages/EditorPage.tsx` | Pass plugins to `renderMarkdown` preview, merge CodeMirror extensions |
| `scribe-react/src/plugins.ts` | **New.** Plugin registry (maps library prefixes to plugins) |
| `scribe-react/src/route.ts` | Wrap library routes in `PluginProvider` |

No schema changes. No new dependencies in the core (plugins bring their own).

## API Versioning & Compatibility

### Version contract

Every plugin declares `apiVersion: N`. The runtime exports `SCRIBE_PLUGIN_API_VERSION` and **rejects plugins whose version doesn't match** at registration time:

```typescript
function validatePlugin(plugin: ScribePlugin): void {
  if (plugin.apiVersion !== SCRIBE_PLUGIN_API_VERSION) {
    console.error(
      `Plugin "${plugin.name}" targets API v${plugin.apiVersion}, ` +
      `but this version of scribe requires v${SCRIBE_PLUGIN_API_VERSION}. ` +
      `Skipping.`
    )
  }
}
```

This is a hard gate: a mismatched plugin is silently skipped rather than loaded with undefined behavior. Plugins fail loudly at startup instead of subtly at runtime.

### What constitutes a breaking change (bump `SCRIBE_PLUGIN_API_VERSION`)

- Removing or renaming a field on `ScribePlugin`
- Changing the signature of `transformHtml`, `mounts[].Component`, or `Effect`
- Changing the props/context available to mounted components
- Upgrading micromark or CodeMirror major versions (extension APIs may differ)

### What does NOT require a version bump

- Adding new optional fields to `ScribePlugin` (old plugins simply don't use them)
- Bug fixes in how the runtime processes plugins
- Changes to internal app code that don't affect the plugin-facing API

### Scoped surface area

The plugin API is deliberately narrow. Plugins interact with scribe through exactly two integration surfaces:

1. **The markdown pipeline** — micromark extensions, HTML transforms, and DOM mounts. Plugins extend how markdown is parsed and rendered, but they don't have access to the note data model, the database, sync state, or routing.

2. **The CodeMirror editor** — plugins provide CodeMirror extensions that are merged into the editor. These follow CodeMirror's own extension API and don't touch scribe internals.

The `Effect` component is the only "escape hatch" — it can use browser APIs (wake lock, clipboard, etc.) but receives no props and has no access to scribe context. If a plugin needs to read the current note content, it should do so through the CodeMirror editor state (via a CodeMirror extension), not by reaching into scribe internals.

This tight scoping means:

- **Refactoring scribe internals** (data model, routing, sync, collections) **cannot break plugins** — plugins never see those layers.
- **The compatibility boundary is small and testable** — we can write a conformance test suite that exercises the full plugin interface with a mock plugin.
- **Security is simpler** — plugins can't access encryption keys, raw database handles, or make network requests through scribe. A malicious plugin is limited to what it can do in a React component or CodeMirror extension.

### Plugin-to-plugin isolation

Plugins are composed but not aware of each other. Potential conflicts:

| Conflict | Resolution |
|---|---|
| Two micromark extensions claim the same syntax | Micromark processes extensions in order; first match wins. Document that plugins should use namespaced syntax (e.g. `` ```tabs `` not `` ``` ``) |
| Two plugins mount to the same CSS selector | Both mount — each creates its own React root in matching elements. Avoid generic selectors; use `[data-plugin-NAME]` convention |
| Overlapping CodeMirror keymaps | CodeMirror's `keymap` facet has built-in precedence. Plugins can use `Prec.high()` / `Prec.low()` to control priority |
| Conflicting `transformHtml` transforms | Transforms compose in plugin order. Plugins should be additive (add attributes, wrap elements) rather than destructive (strip HTML) |
