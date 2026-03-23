# Scribe Plugin System Design

## Problem

Different libraries need different capabilities:

- A recipe library wants a "keep screen on" mode to prevent mobile timeouts while cooking
- A music library wants an interactive guitar tab editor (a full React component)
- A math library wants LaTeX rendering in markdown

These behaviors should be activatable **per-library**, developed **outside the core codebase** (separate npm packages or repos), and composed together. Users should be able to add plugins without modifying the scribe source code.

## Plugin Interface

A plugin module's default export is a factory function that receives a config dict and returns a `ScribePlugin`:

```typescript
// scribe-react-common/src/plugins/types.ts

import { Extension as MicromarkExtension } from 'micromark-util-types'
import { HtmlExtension as MicromarkHtmlExtension } from 'micromark-util-types'
import { Extension as CmExtension } from '@codemirror/state'
import { ComponentType, ReactNode } from 'react'

export const SCRIBE_PLUGIN_API_VERSION = 1

export type PluginConfig = Record<string, string>

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

/**
 * A plugin module's default export. The runtime calls this with
 * the user-provided config dict to produce the active plugin.
 */
export type ScribePluginFactory = (config: PluginConfig) => ScribePlugin
```

### Why this shape?

| Scenario | Which fields | How it works |
|---|---|---|
| Keep screen on | `Effect` + config | Config controls behavior: `mode: "always"` keeps screen on for all notes, `mode: "directive"` only when `<!-- wake-lock -->` is present. The factory reads config and returns the appropriate `Effect` component |
| Guitar tab editor | `micromark` + `mounts` | A micromark extension parses `` ```tabs `` fenced code blocks into `<div data-plugin="guitar-tabs" data-tab="...">` placeholder elements; `mounts` finds those divs and renders the React tab editor into each |
| Math rendering | `micromark` + `transformHtml` *or* `mounts` | A micromark extension parses `$...$` / `$$...$$` into `<span data-math="...">` placeholders; either `transformHtml` calls KaTeX's `renderToString` to produce static HTML, or `mounts` renders a React KaTeX component |

All three use the same plugin shape. A plugin can use any combination of fields.

## Per-Library Activation

Plugins are declared per-library as part of the library's configuration. Each entry is a remote ES module URL plus an optional config dict:

```typescript
// Per-library plugin configuration (stored in library metadata)
interface PluginEntry {
  /** URL of the ES module to import, e.g. "https://esm.sh/scribe-plugin-wake-lock" */
  url: string
  /** String key/value config passed to the plugin factory */
  config?: PluginConfig
}
```

Example library configuration:

```json
{
  "plugins": [
    {
      "url": "https://esm.sh/scribe-plugin-wake-lock",
      "config": { "mode": "always" }
    },
    {
      "url": "https://esm.sh/scribe-plugin-guitar-tabs",
      "config": {}
    }
  ]
}
```

### Loading plugins

Plugins are loaded via dynamic `import()` at runtime. The runtime fetches each module, calls its default export (the factory function) with the provided config, validates the result, and makes it available through context:

```typescript
async function loadPlugin(entry: PluginEntry): Promise<ScribePlugin | null> {
  try {
    const mod = await import(/* webpackIgnore: true */ entry.url)
    const factory: ScribePluginFactory = mod.default
    const plugin = factory(entry.config ?? {})

    if (plugin.apiVersion !== SCRIBE_PLUGIN_API_VERSION) {
      console.error(
        `Plugin "${plugin.name}" targets API v${plugin.apiVersion}, ` +
        `but this version of scribe requires v${SCRIBE_PLUGIN_API_VERSION}. Skipping.`
      )
      return null
    }

    return plugin
  } catch (err) {
    console.error(`Failed to load plugin from ${entry.url}:`, err)
    return null
  }
}
```

### Trust & Security Warning

> **WARNING: Plugins are remote code that runs with full access to your decrypted note content.**
>
> When you add a plugin to a library, that plugin can:
> - Read and modify the rendered content of every note in that library
> - Execute arbitrary JavaScript in your browser
> - Make network requests to external servers
> - Access anything visible in the browser tab
>
> **You must trust the plugin author.** Only add plugins from sources you trust. Scribe cannot sandbox plugin code — a plugin has the same capabilities as any JavaScript running on the page.

The UI must display this warning (or a concise version of it) when the user adds a new plugin URL to a library. The user must explicitly confirm before the plugin is loaded.

## Runtime Integration

### 1. Plugin Context

A React context makes the active (loaded) plugins available to all components:

```typescript
// scribe-react-common/src/context/pluginContext.tsx
import { createContext, useContext } from 'react'
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
      {plugins.map((p) =>
        p.Effect ? <p.Effect key={p.name} /> : null
      )}
      {children}
    </PluginContext.Provider>
  )
}

export function usePlugins(): ScribePlugin[] {
  return useContext(PluginContext)
}
```

The `PluginProvider` wraps each library's route subtree. The route wrappers load plugins from the library's configuration, then provide them:

```tsx
// in PkRouteWrapper / NamedRouteResolver
const [plugins, setPlugins] = useState<ScribePlugin[]>([])

useEffect(() => {
  async function load() {
    const entries = getLibraryPluginEntries(prefix) // from library metadata
    const loaded = await Promise.all(entries.map(loadPlugin))
    setPlugins(loaded.filter((p): p is ScribePlugin => p !== null))
  }
  load()
}, [prefix])

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

### 4. CodeMirror Extensions

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

A plugin that uses config to control its behavior:

```typescript
// scribe-plugin-wake-lock/src/index.ts
import { useEffect } from 'react'
import { ScribePlugin, PluginConfig } from 'scribe-react-common/src/plugins/types'

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

// Default export: the plugin factory
export default function wakeLock(config: PluginConfig): ScribePlugin {
  const mode = config.mode ?? 'always' // "always" | "directive"

  if (mode === 'directive') {
    // Only activate when <!-- wake-lock --> directive is in the note
    // (would need a micromark extension + Effect that checks for the directive)
  }

  return {
    name: 'wake-lock',
    apiVersion: 1,
    Effect: mode === 'always' ? WakeLockEffect : undefined,
  }
}
```

Config: `{ "mode": "always" }` or `{ "mode": "directive" }`.

## Example: Guitar Tab Editor Plugin

```typescript
// scribe-plugin-guitar-tabs/src/index.ts
import { ScribePlugin, PluginConfig } from 'scribe-react-common/src/plugins/types'
import { tabsSyntax, tabsHtml } from './micromark-tabs'
import { TabEditor } from './TabEditor'

export default function guitarTabs(config: PluginConfig): ScribePlugin {
  return {
    name: 'guitar-tabs',
    apiVersion: 1,

    micromark: {
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
}
```

## Example: Math Rendering Plugin

```typescript
// scribe-plugin-math/src/index.ts
import { math as mathSyntax, mathHtml } from 'micromark-extension-math'
import katex from 'katex'
import { ScribePlugin, PluginConfig } from 'scribe-react-common/src/plugins/types'

export default function math(config: PluginConfig): ScribePlugin {
  return {
    name: 'math',
    apiVersion: 1,

    micromark: {
      extensions: [mathSyntax()],
      htmlExtensions: [mathHtml({ renderToString: katex.renderToString })],
    },
  }
}
```

This one doesn't even need `mounts` or `transformHtml` — the existing `micromark-extension-math` package does everything at the micromark level.

## Developer Experience

### Creating a new plugin

1. Create a new package (npm, or any web-accessible location)
2. Default-export a factory function: `(config: PluginConfig) => ScribePlugin`
3. Publish or host the ES module somewhere accessible (npm + esm.sh, your own CDN, etc.)
4. Add the URL to a library's plugin config

### Testing plugins in isolation

A plugin factory returns a plain object — its individual pieces are independently testable:
- Micromark extensions: test input markdown → output HTML
- React components: render with React Testing Library
- Effects: test with standard React hook testing
- Factory: test that different config values produce the expected plugin shape

## Changes Required

Summary of files to touch:

| File | Change |
|---|---|
| `scribe-react-common/src/plugins/types.ts` | **New.** `ScribePlugin` interface, `ScribePluginFactory`, `PluginConfig` |
| `scribe-react-common/src/plugins/loadPlugin.ts` | **New.** `loadPlugin()` — dynamic import + validation |
| `scribe-react-common/src/context/pluginContext.tsx` | **New.** `PluginProvider` + `usePlugins` |
| `scribe-react-common/src/plugins/useMountPlugins.ts` | **New.** Hook for mounting React components into rendered HTML |
| `scribe-react-common/src/utils/markdown.ts` | Extend `renderMarkdown` to accept plugins |
| `scribe-react-note/src/pages/NoteViewPage.tsx` | Pass plugins to `renderMarkdown`, use `useMountPlugins` |
| `scribe-react-note/src/pages/EditorPage.tsx` | Pass plugins to `renderMarkdown` preview, merge CodeMirror extensions |
| `scribe-react/src/route.ts` | Wrap library routes in `PluginProvider`, load plugins from library metadata |

No new bundled dependencies in the core (plugins bring their own via their remote modules).

## API Versioning & Compatibility

### Version contract

Every plugin declares `apiVersion: N`. The runtime exports `SCRIBE_PLUGIN_API_VERSION` and **rejects plugins whose version doesn't match** at load time. Mismatched plugins are skipped with a console error rather than loaded with undefined behavior.

### What constitutes a breaking change (bump `SCRIBE_PLUGIN_API_VERSION`)

- Removing or renaming a field on `ScribePlugin`
- Changing the signature of `transformHtml`, `mounts[].Component`, or `Effect`
- Changing the factory signature (e.g. adding required parameters beyond `config`)
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
- **Security note** — while plugins are scoped to the editor/renderer API, they are still remote JavaScript running on the page. They *can* access the DOM, make network requests, etc. The scoped API limits accidental coupling, not malicious behavior. See the [Trust & Security Warning](#trust--security-warning) above.

### Plugin-to-plugin isolation

Plugins are composed but not aware of each other. Potential conflicts:

| Conflict | Resolution |
|---|---|
| Two micromark extensions claim the same syntax | Micromark processes extensions in order; first match wins. Document that plugins should use namespaced syntax (e.g. `` ```tabs `` not `` ``` ``) |
| Two plugins mount to the same CSS selector | Both mount — each creates its own React root in matching elements. Avoid generic selectors; use `[data-plugin-NAME]` convention |
| Overlapping CodeMirror keymaps | CodeMirror's `keymap` facet has built-in precedence. Plugins can use `Prec.high()` / `Prec.low()` to control priority |
| Conflicting `transformHtml` transforms | Transforms compose in plugin order. Plugins should be additive (add attributes, wrap elements) rather than destructive (strip HTML) |
