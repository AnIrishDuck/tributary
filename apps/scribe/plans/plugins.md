# Plugin System Implementation Plan

Reference: [Plugin Author Guide](../docs/plugins.md)

## Motivation

Different libraries need different capabilities:

- A recipe library wants a "keep screen on" mode to prevent mobile timeouts while cooking
- A music library wants an interactive guitar tab editor (a full React component)
- A math library wants LaTeX rendering in markdown

These should be activatable per-library, developed outside the core codebase, and composed together. Users should be able to add plugins without modifying the scribe source code.

## Key Design Decisions

### Why remote dynamic imports?

We considered three approaches for plugin loading:

1. **Hardcoded registry** — every plugin imported into the core app. Simple, but defeats the purpose: adding a plugin means modifying source code and redeploying.
2. **Import maps** — host declares available plugins, libraries select from that set. More decoupled, but the deployer still has to bundle every possible plugin.
3. **Remote dynamic imports** — plugins are ES modules at arbitrary URLs, loaded via `import()` at runtime. The user adds a URL, scribe fetches and executes it. No source changes, no redeployment. **This is what we chose.**

The tradeoff is security: remote code has full access to decrypted content. We mitigate this with an explicit trust warning, not sandboxing (which isn't practical for the deep integration plugins need with micromark and CodeMirror).

### Why a factory function with config?

A plugin could just export a static `ScribePlugin` object. But plugins need per-library configuration — e.g. the wake-lock plugin should support `{ mode: "always" }` vs `{ mode: "directive" }` to control whether it activates on all notes or only when a markdown directive is present.

A factory `(config: PluginConfig) => ScribePlugin` lets the same module produce different behavior based on config. `PluginConfig` is `Record<string, string>` — deliberately simple. String key/values are easy to store, display in a settings UI, and serialize. If a plugin needs complex config, it can JSON-parse a string value.

### Why scope to editor and renderer only?

Plugins could theoretically access the data model, sync state, routing, etc. We deliberately restrict the API to two surfaces:

1. **The markdown pipeline** — micromark extensions, HTML transforms, DOM mounts
2. **The CodeMirror editor** — CodeMirror extensions

This means refactoring scribe internals (data model, routing, sync, collections) cannot break plugins. The compatibility boundary is small and testable. The `Effect` component is the only escape hatch — it can use browser APIs but receives no props and no scribe context.

Note: this scoping limits accidental coupling, not malicious behavior. Plugins are still JavaScript on the page and can do anything JavaScript can do. The trust warning covers this.

### Why version the API?

Plugins are compiled separately from scribe — TypeScript won't catch interface drift at build time. Without versioning, a renamed field or changed signature would cause plugins to silently malfunction.

Every plugin declares `apiVersion: N`. The loader rejects mismatches at startup. This means plugins fail loudly and immediately rather than subtly at runtime. The version bump policy (documented in the author guide) distinguishes breaking changes from safe additions.

### Why a synced table for storage?

Plugin configuration must sync across devices — if you add a guitar-tabs plugin to your music library on your laptop, it should be there on your phone too. This means plugin entries must be stored in a synced table (via `stream.exec()`), not a local-only table.

We use a dedicated `library_plugins` table in each library's stream rather than adding columns to the `collection` table, because plugins are a per-library concept (not per-collection) and the config is structured (ordered list of URL + config entries).

---

## Trust & Security Warning

Plugins are remote code. The UI must display this warning when the user adds a new plugin URL and require explicit confirmation before saving:

> **Plugins are remote code with full access to your decrypted note content.**
>
> When you add a plugin to a library, that plugin can:
> - Read and modify the rendered content of every note in that library
> - Execute arbitrary JavaScript in your browser
> - Make network requests to external servers
> - Access anything visible in the browser tab
>
> **You must trust the plugin author.** Only add plugins from sources you trust.

---

## Internal Architecture

### Storage schema

Per-library synced table (created via `stream.exec()` in `syncedMigrations`):

```sql
CREATE TABLE IF NOT EXISTS library_plugins (
  plugin_url TEXT NOT NULL PRIMARY KEY,
  config_json TEXT NOT NULL DEFAULT '{}',
  sort_order INTEGER NOT NULL DEFAULT 0
)
```

No `stream_id` column needed — each library stream has its own database, so the table is scoped to the library inherently.

For existing libraries that were created before the plugin system, the `CREATE TABLE IF NOT EXISTS` migration must run on first access. This means `syncedMigrations` needs to be called not just at library creation but also when loading a library that doesn't yet have the table. The `IF NOT EXISTS` clause makes this idempotent.

### Plugin loading

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

### Plugin context

```typescript
const PluginContext = createContext<ScribePlugin[]>([])

export function PluginProvider({ plugins, children }: { plugins: ScribePlugin[]; children: ReactNode })
export function usePlugins(): ScribePlugin[]
```

`PluginProvider` also renders each plugin's `Effect` component. It wraps each library's route subtree — the route wrappers (`PkRouteWrapper`, `NamedRouteResolver`) load plugin entries from the synced table, call `loadPlugin` for each, and pass the results to the provider.

### Markdown rendering

`renderMarkdown` gains an optional `plugins` parameter. Merges micromark extensions, then runs `transformHtml` in plugin order:

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

`useMountPlugins(containerRef, plugins)` — after rendered HTML is in the DOM, queries for each plugin's mount selectors and renders React components into matching elements. Cleans up roots on unmount.

### CodeMirror extensions

`EditorPage` merges `plugins.flatMap(p => p.codemirror ?? [])` into the editor's extension array.

### Files to touch

| File | Change |
|---|---|
| `scribe-data/src/migrations.ts` | Add `library_plugins` synced table |
| `scribe-data/src/types.ts` | Add `PluginEntry` type |
| `scribe-data/src/library.ts` | Add `getLibraryPlugins()`, `setLibraryPlugins()` |
| `scribe-react-common/src/plugins/types.ts` | **New.** `ScribePlugin`, `ScribePluginFactory`, `PluginConfig` |
| `scribe-react-common/src/plugins/loadPlugin.ts` | **New.** Dynamic import + validation |
| `scribe-react-common/src/context/pluginContext.tsx` | **New.** `PluginProvider` + `usePlugins` |
| `scribe-react-common/src/plugins/useMountPlugins.ts` | **New.** Mount hook |
| `scribe-react-common/src/utils/markdown.ts` | Extend `renderMarkdown` to accept plugins |
| `scribe-react-note/src/pages/NoteViewPage.tsx` | Pass plugins to `renderMarkdown`, use `useMountPlugins` |
| `scribe-react-note/src/pages/EditorPage.tsx` | Pass plugins to `renderMarkdown` preview, merge CodeMirror extensions |
| `scribe-react/src/components/PkRouteWrapper.tsx` | Load plugins, wrap in `PluginProvider` |
| `scribe-react/src/components/NamedRouteResolver.tsx` | Same |

---

## Implementation Tasks

### Task 1: Plugin types, config, and loader

**Package:** `scribe-react-common`

#### Files to create

- `src/plugins/types.ts` — `ScribePlugin`, `ScribePluginFactory`, `PluginConfig`, `SCRIBE_PLUGIN_API_VERSION`
- `src/plugins/loadPlugin.ts` — `loadPlugin(entry: PluginEntry): Promise<ScribePlugin | null>`

#### Tests (`src/plugins/loadPlugin.test.ts`)

- Calls factory with provided config dict
- Rejects plugin with wrong `apiVersion` (returns null, logs error)
- Rejects module with no default export (returns null, logs error)
- Passes empty config when none provided
- Returns valid plugin when everything matches

#### Notes

- Tests can mock `import()` by having `loadPlugin` accept an optional import function for testability: `loadPlugin(entry, importFn?)`

---

### Task 2: Plugin context and Effect rendering

**Package:** `scribe-react-common`

#### Files to create

- `src/context/pluginContext.tsx` — `PluginProvider`, `usePlugins()` hook. The provider renders `Effect` components for each plugin that has one.

#### Tests (`src/context/pluginContext.test.tsx`)

- `usePlugins()` returns empty array when no provider
- `usePlugins()` returns provided plugins
- Effect components are rendered when present
- Effect components are not rendered when absent
- Multiple plugins' Effects all render

---

### Task 3: Markdown rendering with plugins

**Package:** `scribe-react-common`

#### Files to modify

- `src/utils/markdown.ts` — Add `plugins?: ScribePlugin[]` parameter to `renderMarkdown`

#### Tests (add to `src/utils/markdown.test.ts`)

- Plugin micromark extensions are applied
- Plugin HTML extensions are applied
- `transformHtml` is called in plugin order
- Multiple plugins' extensions compose correctly
- No plugins = existing behavior unchanged

#### Notes

- Existing tests must continue to pass unchanged
- The function signature change is backwards-compatible (new param is optional)

---

### Task 4: useMountPlugins hook

**Package:** `scribe-react-common`

#### Files to create

- `src/plugins/useMountPlugins.ts`

#### Tests (`src/plugins/useMountPlugins.test.tsx`)

- Mounts component into element matching selector
- Passes element to Component as prop
- Handles multiple selectors from multiple plugins
- Cleans up React roots on unmount
- Does nothing when no mounts defined
- Does nothing when no matching elements exist

---

### Task 5: Integrate plugins into NoteViewPage and EditorPage

**Packages:** `scribe-react-note`, `scribe-react`

#### Files to modify

- `scribe-react-note/src/pages/NoteViewPage.tsx` — `usePlugins()`, pass to `renderMarkdown()`, `useMountPlugins()`
- `scribe-react-note/src/pages/EditorPage.tsx` — `usePlugins()`, pass to `renderMarkdown()` in preview, merge codemirror extensions
- `scribe-react/src/components/PkRouteWrapper.tsx` — Wrap in `PluginProvider` (empty array for now)
- `scribe-react/src/components/NamedRouteResolver.tsx` — Same

#### Tests to update

- `scribe-react/tests/PkRouteWrapper.test.tsx` — Verify PluginProvider is in tree
- `scribe-react/tests/NamedRouteResolver.test.tsx` — Same
- `scribe-react/tests/NoteViewPage.test.tsx` — Verify renderMarkdown receives plugins
- `scribe-react/tests/EditorPage.test.tsx` — Verify plugin codemirror extensions included, preview uses plugins

---

### Task 6: Library plugin configuration storage (synced)

**Package:** `scribe-data`

#### Files to modify

- `src/migrations.ts` — Add `library_plugins` table to `syncedMigrations()`
- `src/types.ts` — Add `PluginEntry` type
- `src/library.ts` — Add `getLibraryPlugins(stream, streamId)` and `setLibraryPlugins(stream, streamId, entries)`

#### Notes on migration for existing libraries

`syncedMigrations()` is currently only called at library creation. For existing libraries, we need to ensure the `library_plugins` table is created on first access. Options:
- Run `syncedMigrations()` on library load (safe due to `IF NOT EXISTS`)
- Or add a separate `pluginMigrations()` called from the route wrappers

#### Tests (`tests/library-plugins.test.ts`)

- Empty plugins for new library
- Set and retrieve plugin entries
- Config is round-tripped correctly as JSON
- Replacing plugins list replaces all entries
- Plugin order is preserved via sort_order

---

### Task 7: Wire plugin loading into route wrappers

**Packages:** `scribe-react`, `scribe-react-common`

#### Files to modify

- `scribe-react/src/components/PkRouteWrapper.tsx` — Load plugin entries via `getLibraryPlugins()`, call `loadPlugin()`, pass to `PluginProvider`
- `scribe-react/src/components/NamedRouteResolver.tsx` — Same

#### Tests (`scribe-react/tests/pluginLoading.test.tsx`)

- Plugins load from library config and appear in context
- Failed plugin loads are skipped gracefully
- API version mismatch skips plugin
- Empty plugin config works
- Plugin config values are passed through to factory

---

### Task 8: Plugin management UI with trust warning

**Package:** `scribe-react-listing` (or wherever library settings live)

#### UI

- "Plugins" section in library settings page
- List current plugins (URL + config)
- "Add plugin" form: URL input + config key/value editor
- "Remove plugin" button per entry
- Reorder plugins (drag or up/down buttons)
- Trust warning dialog on add (see [Trust & Security Warning](#trust--security-warning))
- User must confirm before plugin is saved

#### Tests

- Adding a plugin shows the trust warning
- Dismissing the warning does not add the plugin
- Confirming the warning saves the plugin entry
- Removing a plugin updates the list
- Rendering with zero, one, and multiple plugins

---

### Task 9: Manual testing

- [ ] Create a test plugin ES module with a simple micromark extension
- [ ] Add the plugin URL via the settings UI
- [ ] Verify the trust warning appears and must be confirmed
- [ ] Create a note using the custom syntax
- [ ] Verify the rendered view shows the custom HTML
- [ ] Verify the editor preview shows the custom HTML
- [ ] Verify a CodeMirror extension from the plugin is active
- [ ] Verify an Effect component mounts/unmounts on library enter/leave
- [ ] Verify plugin config is passed through correctly
- [ ] Navigate to a different library — verify the plugin is NOT active there
- [ ] Remove the plugin from library settings — verify it's no longer loaded
- [ ] Add a plugin with wrong `apiVersion` — verify it's skipped with console error
- [ ] Add a plugin with an unreachable URL — verify graceful failure
- [ ] Verify all existing tests still pass
