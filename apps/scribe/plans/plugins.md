# Plugin System Implementation Plan

Reference: [Plugin Spec](../docs/plugins.md)

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

Every plugin declares `apiVersion: N`. The loader rejects mismatches at startup. This means plugins fail loudly and immediately rather than subtly at runtime. The version bump policy (documented in the spec) distinguishes breaking changes from safe additions.

## Example Plugins

### Wake Lock (Effect + config)

```typescript
export default function wakeLock(config: PluginConfig): ScribePlugin {
  const mode = config.mode ?? 'always'
  return {
    name: 'wake-lock',
    apiVersion: 1,
    Effect: mode === 'always' ? WakeLockEffect : undefined,
  }
}
```

Config `{ mode: "always" }` keeps screen on for all notes. Config `{ mode: "directive" }` would only activate when `<!-- wake-lock -->` is present (needs a micromark extension to detect the directive).

### Guitar Tab Editor (micromark + mounts)

A micromark extension parses `` ```tabs `` fenced code blocks into `<div data-plugin-tabs data-content="...">` placeholders. The `mounts` field finds those divs and renders a full React tab editor into each.

### Math Rendering (micromark only)

Uses the existing `micromark-extension-math` package. The factory just wires it in — no mounts, no transforms, no effects needed.

---

## Implementation Tasks

### Task 1: Plugin types, config, and loader

**Package:** `scribe-react-common`

Create the core plugin infrastructure that everything else depends on.

#### Files to create

- `src/plugins/types.ts` — `ScribePlugin`, `ScribePluginFactory`, `PluginConfig`, `SCRIBE_PLUGIN_API_VERSION`
- `src/plugins/loadPlugin.ts` — `loadPlugin(entry: PluginEntry): Promise<ScribePlugin | null>` that does dynamic `import()`, calls the factory with config, and validates `apiVersion`

#### Files to create (tests)

- `src/plugins/loadPlugin.test.ts`:
  - Calls factory with provided config dict
  - Rejects plugin with wrong `apiVersion` (returns null, logs error)
  - Rejects module with no default export (returns null, logs error)
  - Passes empty config when none provided
  - Returns valid plugin when everything matches

#### Notes

- `loadPlugin` should accept a `PluginEntry` (`{ url: string, config?: PluginConfig }`)
- Tests can mock `import()` by having `loadPlugin` accept an optional import function for testability: `loadPlugin(entry, importFn?)`
- No UI in this task

---

### Task 2: Plugin context and Effect rendering

**Package:** `scribe-react-common`

#### Files to create

- `src/context/pluginContext.tsx` — `PluginProvider`, `usePlugins()` hook. The provider renders `Effect` components for each plugin that has one.

#### Files to create (tests)

- `src/context/pluginContext.test.tsx`:
  - `usePlugins()` returns empty array when no provider
  - `usePlugins()` returns provided plugins
  - Effect components are rendered when present
  - Effect components are not rendered when absent
  - Multiple plugins' Effects all render

---

### Task 3: Markdown rendering with plugins

**Package:** `scribe-react-common`

#### Files to modify

- `src/utils/markdown.ts` — Add `plugins?: ScribePlugin[]` parameter to `renderMarkdown`. Merge micromark extensions and run `transformHtml` chain.

#### Files to modify (tests)

- `src/utils/markdown.test.ts` — Add new tests:
  - Plugin micromark extensions are applied (e.g. a test extension that turns `::test::` into `<span class="test">`)
  - Plugin HTML extensions are applied
  - `transformHtml` is called in plugin order
  - Multiple plugins' extensions compose correctly
  - No plugins = existing behavior unchanged

#### Notes

- Existing tests must continue to pass unchanged.
- The function signature change is backwards-compatible (new param is optional).

---

### Task 4: useMountPlugins hook

**Package:** `scribe-react-common`

#### Files to create

- `src/plugins/useMountPlugins.ts` — Hook that queries the container for each plugin's mount selectors and renders React components into matching elements.

#### Files to create (tests)

- `src/plugins/useMountPlugins.test.tsx`:
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

- `scribe-react-note/src/pages/NoteViewPage.tsx`:
  - Call `usePlugins()` to get active plugins
  - Pass plugins to `renderMarkdown()`
  - Add ref to prose container and call `useMountPlugins()`

- `scribe-react-note/src/pages/EditorPage.tsx`:
  - Call `usePlugins()` to get active plugins
  - Pass plugins to `renderMarkdown()` in preview mode
  - Merge `plugin.codemirror` extensions into the CodeMirror `extensions` array

- `scribe-react/src/components/PkRouteWrapper.tsx`:
  - Wrap `<Outlet />` in `<PluginProvider>`
  - For now, pass an empty plugin array (wiring to real config comes in Task 7)

- `scribe-react/src/components/NamedRouteResolver.tsx`:
  - Same as PkRouteWrapper

#### Files to modify (tests)

- `scribe-react/tests/PkRouteWrapper.test.tsx` — Verify PluginProvider is present in tree (child can call `usePlugins()`)
- `scribe-react/tests/NamedRouteResolver.test.tsx` — Same
- `scribe-react/tests/NoteViewPage.test.tsx` — Verify renderMarkdown receives plugins from context
- `scribe-react/tests/EditorPage.test.tsx` — Verify plugin codemirror extensions are included, preview uses plugins

---

### Task 6: Library plugin configuration storage

**Package:** `scribe-data`

Store plugin entries (URL + config) per library.

#### Files to modify

- `src/types.ts` — Add `PluginEntry` type
- `src/migrations.ts` — Add migration creating the `library_plugins` table
- `src/library.ts` — Add `getLibraryPlugins(db, streamId)` and `setLibraryPlugins(db, streamId, entries)`

#### Files to create (tests)

- `tests/library-plugins.test.ts`:
  - Empty plugins for new library
  - Set and retrieve plugin entries
  - Config is round-tripped correctly as JSON
  - Replacing plugins list replaces all entries
  - Plugin order is preserved via sort_order

---

### Task 7: Wire plugin loading into route wrappers

**Packages:** `scribe-react`, `scribe-react-common`

Connect the data layer (Task 6) to the plugin loader (Task 1) and context (Task 2).

#### Files to modify

- `scribe-react/src/components/PkRouteWrapper.tsx`:
  - Load plugin entries from library metadata via `getLibraryPlugins()`
  - Call `loadPlugin()` for each entry
  - Pass loaded plugins to `PluginProvider`

- `scribe-react/src/components/NamedRouteResolver.tsx`:
  - Same pattern

#### Files to create (tests)

- `scribe-react/tests/pluginLoading.test.tsx`:
  - Plugins load from library config and appear in context
  - Failed plugin loads are skipped gracefully
  - API version mismatch skips plugin
  - Empty plugin config works
  - Plugin config values are passed through to factory

---

### Task 8: Plugin management UI with trust warning

**Package:** `scribe-react-listing` (or `scribe-react`, wherever library settings live)

#### Files to create/modify

- Add a "Plugins" section to the library settings page:
  - List current plugins (URL + config summary)
  - "Add plugin" form: URL input + config key/value editor
  - "Remove plugin" button per entry
  - Reorder plugins (drag or up/down buttons)
  - **Trust warning dialog** shown on add: "Plugins are remote code with full access to your decrypted note content. You must trust the plugin author. Only add plugins from sources you trust."
  - User must confirm the warning before the plugin is saved

#### Files to create (tests)

- Test that adding a plugin shows the trust warning
- Test that dismissing the warning does not add the plugin
- Test that confirming the warning saves the plugin entry
- Test that removing a plugin updates the list
- Test rendering with zero plugins, one plugin, multiple plugins

---

### Task 9: Manual testing

End-to-end manual test checklist:

- [ ] Create a test plugin ES module that adds a simple micromark extension
- [ ] Add the plugin URL to a library via the settings UI
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
