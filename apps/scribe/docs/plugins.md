# Scribe Plugin System

Plugins extend scribe's editor and renderer on a per-library basis. They are remote ES modules loaded at runtime via dynamic `import()`.

> **Plugins are remote code with full access to your decrypted note content.** You must trust the plugin author. Only add plugins from sources you trust. Scribe cannot sandbox plugin code — a plugin has the same capabilities as any JavaScript running on the page.

The UI must display this warning when the user adds a new plugin URL to a library. The user must explicitly confirm before the plugin is saved.

## Plugin Interface

A plugin module default-exports a factory function. The runtime calls it with the user-provided config and receives back a `ScribePlugin`:

```typescript
// scribe-react-common/src/plugins/types.ts

import { Extension as MicromarkExtension } from 'micromark-util-types'
import { HtmlExtension as MicromarkHtmlExtension } from 'micromark-util-types'
import { Extension as CmExtension } from '@codemirror/state'
import { ComponentType } from 'react'

export const SCRIBE_PLUGIN_API_VERSION = 1

export type PluginConfig = Record<string, string>

export type ScribePluginFactory = (config: PluginConfig) => ScribePlugin

export interface ScribePlugin {
  name: string
  apiVersion: typeof SCRIBE_PLUGIN_API_VERSION

  micromark?: {
    extensions?: MicromarkExtension[]
    htmlExtensions?: MicromarkHtmlExtension[]
  }

  codemirror?: CmExtension[]

  transformHtml?: (html: string) => string

  mounts?: Array<{
    selector: string
    Component: ComponentType<{ element: HTMLElement }>
  }>

  Effect?: ComponentType
}
```

### Fields

| Field | Purpose |
|---|---|
| `name` | Unique identifier, e.g. `"wake-lock"`, `"guitar-tabs"` |
| `apiVersion` | Must equal `SCRIBE_PLUGIN_API_VERSION`. Mismatched plugins are rejected at load time |
| `micromark` | Micromark syntax and HTML extensions, merged into the `micromark()` call alongside GFM |
| `codemirror` | CodeMirror extensions merged into the editor |
| `transformHtml` | Post-processes rendered HTML after micromark + link resolution. Transforms compose in plugin order |
| `mounts` | After HTML is in the DOM, the runtime queries for elements matching `selector` and renders `Component` into each. Use `[data-plugin-NAME]` selectors |
| `Effect` | Invisible React component rendered when the library is active. Unmounted on navigation away. For side effects only (wake lock, shortcuts, etc.) |

## Per-Library Configuration

Each library stores an ordered list of plugin entries:

```typescript
interface PluginEntry {
  url: string              // ES module URL, e.g. "https://esm.sh/scribe-plugin-wake-lock"
  config?: PluginConfig    // String key/value pairs passed to the factory
}
```

Stored in a `library_plugins` table on the home stream's local DB:

```sql
CREATE TABLE IF NOT EXISTS library_plugins (
  stream_id TEXT NOT NULL,
  plugin_url TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (stream_id, plugin_url)
)
```

## Loading

```typescript
async function loadPlugin(entry: PluginEntry): Promise<ScribePlugin | null> {
  try {
    const mod = await import(/* webpackIgnore: true */ entry.url)
    const factory: ScribePluginFactory = mod.default
    const plugin = factory(entry.config ?? {})

    if (plugin.apiVersion !== SCRIBE_PLUGIN_API_VERSION) {
      console.error(
        `Plugin "${plugin.name}" targets API v${plugin.apiVersion}, ` +
        `but scribe requires v${SCRIBE_PLUGIN_API_VERSION}. Skipping.`
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

Plugins are loaded when entering a library. The route wrappers (`PkRouteWrapper`, `NamedRouteResolver`) read plugin entries from the DB, call `loadPlugin` for each, and pass the results to a `PluginProvider` context that wraps the library's route subtree.

## Runtime Integration

### Markdown rendering

`renderMarkdown` accepts an optional `plugins` parameter. It merges micromark extensions, then runs `transformHtml` in plugin order:

```typescript
export function renderMarkdown(
  content: string,
  streamPrefix: string,
  currentSlug?: string,
  routeBase?: string,
  plugins?: ScribePlugin[]
): string
```

### React mounts

`useMountPlugins(containerRef, plugins)` — after markdown HTML is inserted into the DOM, queries for each plugin's mount selectors and renders React components into matching elements. Cleans up roots on unmount.

### CodeMirror extensions

`EditorPage` merges `plugins.flatMap(p => p.codemirror ?? [])` into the editor's extension array.

### Effect components

`PluginProvider` renders each plugin's `Effect` component (if present). They mount on library enter and unmount on library leave.

### Plugin context

```typescript
const PluginContext = createContext<ScribePlugin[]>([])

export function PluginProvider({ plugins, children }: { plugins: ScribePlugin[]; children: ReactNode })
export function usePlugins(): ScribePlugin[]
```

## API Versioning

Every plugin declares `apiVersion`. Plugins with a mismatched version are skipped at load time.

**Breaking changes** (bump `SCRIBE_PLUGIN_API_VERSION`):
- Removing or renaming a field on `ScribePlugin`
- Changing signatures of `transformHtml`, `mounts[].Component`, `Effect`, or the factory
- Upgrading micromark or CodeMirror major versions

**Non-breaking changes** (no bump needed):
- Adding optional fields to `ScribePlugin`
- Bug fixes in plugin runtime processing
- Internal app changes that don't affect the plugin API

## Plugin-to-Plugin Isolation

| Conflict | Resolution |
|---|---|
| Two micromark extensions claim the same syntax | First match wins. Use namespaced syntax (e.g. `` ```tabs ``) |
| Two plugins mount to the same selector | Both mount. Use `[data-plugin-NAME]` convention |
| Overlapping CodeMirror keymaps | CodeMirror's `keymap` facet precedence. Use `Prec.high()` / `Prec.low()` |
| Conflicting `transformHtml` | Compose in plugin order. Be additive, not destructive |
