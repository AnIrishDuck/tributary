# Plugin System Implementation Plan

Reference: [Plugin Design Doc](../docs/plugins.md)

## Task 1: Plugin types, config, and loader (~400 LOC)

**Package:** `scribe-react-common`

Create the core plugin infrastructure that everything else depends on.

### Files to create

- `src/plugins/types.ts` — `ScribePlugin`, `ScribePluginFactory`, `PluginConfig`, `SCRIBE_PLUGIN_API_VERSION`
- `src/plugins/loadPlugin.ts` — `loadPlugin(entry: PluginEntry): Promise<ScribePlugin | null>` that does dynamic `import()`, calls the factory with config, and validates `apiVersion`

### Files to create (tests)

- `src/plugins/loadPlugin.test.ts`:
  - Calls factory with provided config dict
  - Rejects plugin with wrong `apiVersion` (returns null, logs error)
  - Rejects module with no default export (returns null, logs error)
  - Passes empty config when none provided
  - Returns valid plugin when everything matches

### Notes

- `loadPlugin` should accept a `PluginEntry` (`{ url: string, config?: PluginConfig }`)
- Tests can mock `import()` by having `loadPlugin` accept an optional import function for testability: `loadPlugin(entry, importFn?)`
- No UI in this task

---

## Task 2: Plugin context and Effect rendering (~300 LOC)

**Package:** `scribe-react-common`

### Files to create

- `src/context/pluginContext.tsx` — `PluginProvider`, `usePlugins()` hook. The provider renders `Effect` components for each plugin that has one.

### Files to create (tests)

- `src/context/pluginContext.test.tsx`:
  - `usePlugins()` returns empty array when no provider
  - `usePlugins()` returns provided plugins
  - Effect components are rendered when present
  - Effect components are not rendered when absent
  - Multiple plugins' Effects all render

---

## Task 3: Markdown rendering with plugins (~400 LOC)

**Package:** `scribe-react-common`

### Files to modify

- `src/utils/markdown.ts` — Add `plugins?: ScribePlugin[]` parameter to `renderMarkdown`. Merge micromark extensions and run `transformHtml` chain.

### Files to modify (tests)

- `src/utils/markdown.test.ts` — Add new tests:
  - Plugin micromark extensions are applied (e.g. a test extension that turns `::test::` into `<span class="test">`)
  - Plugin HTML extensions are applied
  - `transformHtml` is called in plugin order
  - Multiple plugins' extensions compose correctly
  - No plugins = existing behavior unchanged

### Notes

- Existing tests must continue to pass unchanged.
- The function signature change is backwards-compatible (new param is optional).

---

## Task 4: useMountPlugins hook (~400 LOC)

**Package:** `scribe-react-common`

### Files to create

- `src/plugins/useMountPlugins.ts` — Hook that queries the container for each plugin's mount selectors and renders React components into matching elements.

### Files to create (tests)

- `src/plugins/useMountPlugins.test.tsx`:
  - Mounts component into element matching selector
  - Passes element to Component as prop
  - Handles multiple selectors from multiple plugins
  - Cleans up React roots on unmount
  - Does nothing when no mounts defined
  - Does nothing when no matching elements exist

---

## Task 5: Integrate plugins into NoteViewPage and EditorPage (~600 LOC)

**Packages:** `scribe-react-note`, `scribe-react`

### Files to modify

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
  - For now, pass an empty plugin array (wiring to real config comes in Task 6)

- `scribe-react/src/components/NamedRouteResolver.tsx`:
  - Same as PkRouteWrapper

### Files to modify (tests)

- `scribe-react/tests/PkRouteWrapper.test.tsx` — Verify PluginProvider is present in tree (child can call `usePlugins()`)
- `scribe-react/tests/NamedRouteResolver.test.tsx` — Same
- `scribe-react/tests/NoteViewPage.test.tsx` — Verify renderMarkdown receives plugins from context
- `scribe-react/tests/EditorPage.test.tsx` — Verify plugin codemirror extensions are included, preview uses plugins

---

## Task 6: Library plugin configuration storage (~600 LOC)

**Package:** `scribe-data`

Store plugin entries (URL + config) per library. This is the data layer that connects library metadata to the plugin loader.

### Files to modify

- `src/types.ts` — Add `PluginEntry` type (or re-export from `scribe-react-common`)
- `src/migrations.ts` — Add migration creating a `library_plugins` table on the home stream's local DB:
  ```sql
  CREATE TABLE IF NOT EXISTS library_plugins (
    stream_id TEXT NOT NULL,
    plugin_url TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (stream_id, plugin_url)
  )
  ```
- `src/library.ts` — Add functions:
  - `getLibraryPlugins(db, streamId): PluginEntry[]`
  - `setLibraryPlugins(db, streamId, entries: PluginEntry[]): void`

### Files to create (tests)

- `tests/library-plugins.test.ts`:
  - Empty plugins for new library
  - Set and retrieve plugin entries
  - Config is round-tripped correctly as JSON
  - Replacing plugins list replaces all entries
  - Plugin order is preserved via sort_order

---

## Task 7: Wire plugin loading into route wrappers (~500 LOC)

**Packages:** `scribe-react`, `scribe-react-common`

Connect the data layer (Task 6) to the plugin loader (Task 1) and context (Task 2).

### Files to modify

- `scribe-react/src/components/PkRouteWrapper.tsx`:
  - Load plugin entries from library metadata via `getLibraryPlugins()`
  - Call `loadPlugin()` for each entry
  - Pass loaded plugins to `PluginProvider`

- `scribe-react/src/components/NamedRouteResolver.tsx`:
  - Same pattern

### Files to create (tests)

- `scribe-react/tests/pluginLoading.test.tsx`:
  - Plugins load from library config and appear in context
  - Failed plugin loads are skipped gracefully
  - API version mismatch skips plugin
  - Empty plugin config works
  - Plugin config values are passed through to factory

---

## Task 8: Plugin management UI with trust warning (~600 LOC)

**Package:** `scribe-react-listing` (or `scribe-react`, wherever library settings live)

### Files to create/modify

- Add a "Plugins" section to the library settings page:
  - List current plugins (URL + config summary)
  - "Add plugin" form: URL input + JSON config textarea
  - "Remove plugin" button per entry
  - Reorder plugins (drag or up/down buttons)
  - **Trust warning dialog** shown on add: "Plugins are remote code with full access to your decrypted note content. You must trust the plugin author. Only add plugins from sources you trust."
  - User must confirm the warning before the plugin is saved

### Files to create (tests)

- Test that adding a plugin shows the trust warning
- Test that dismissing the warning does not add the plugin
- Test that confirming the warning saves the plugin entry
- Test that removing a plugin updates the list
- Test rendering with zero plugins, one plugin, multiple plugins

---

## Task 9: Manual testing

End-to-end manual test checklist:

- [ ] Create a test plugin ES module (can use a local dev server or esm.sh) that adds a simple micromark extension (e.g. renders `::highlight::text::` as `<mark>text</mark>`)
- [ ] Add the plugin URL to a library via the settings UI
- [ ] Verify the trust warning appears and must be confirmed
- [ ] Create a note using the custom syntax
- [ ] Verify the rendered view shows the custom HTML
- [ ] Verify the editor preview shows the custom HTML
- [ ] Verify a CodeMirror extension from the plugin is active (if applicable)
- [ ] Verify an Effect component from the plugin mounts/unmounts on library enter/leave
- [ ] Verify plugin config is passed through (e.g. test with two different config values producing different behavior)
- [ ] Navigate to a different library — verify the plugin is NOT active there
- [ ] Remove the plugin from library settings — verify it's no longer loaded
- [ ] Add a plugin with wrong `apiVersion` — verify it's skipped with console error
- [ ] Add a plugin with an unreachable URL — verify graceful failure
- [ ] Verify all existing tests still pass: `npm test` across all packages
