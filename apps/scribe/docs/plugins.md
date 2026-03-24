# Scribe Plugins

Plugins extend scribe's markdown renderer and CodeMirror editor on a per-library basis. A plugin is an ES module that default-exports a factory function.

## Quick Start

1. Create a package that default-exports a factory function
2. Publish it as an ES module (npm + esm.sh, your own CDN, etc.)
3. Add the URL to a library's plugin settings in the scribe UI

## Plugin Interface

```typescript
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
| `mounts` | After rendered HTML is in the DOM, the runtime queries for elements matching `selector` and renders `Component` into each. Use `[data-plugin-NAME]` selectors |
| `Effect` | Invisible React component rendered when the library is active. Unmounted on navigation away. For side effects only (wake lock, shortcuts, etc.). Receives no props |

### Config

The factory receives a `PluginConfig` (`Record<string, string>`) — string key/value pairs configured by the user in the library settings UI. Use config to control plugin behavior without requiring separate modules for each variant.

### API Versioning

Every plugin must set `apiVersion` to `SCRIBE_PLUGIN_API_VERSION` (currently `1`). The runtime rejects plugins with a mismatched version.

**Breaking changes** that bump `SCRIBE_PLUGIN_API_VERSION`:
- Removing or renaming a field on `ScribePlugin`
- Changing signatures of `transformHtml`, `mounts[].Component`, `Effect`, or the factory
- Upgrading micromark or CodeMirror major versions

**Non-breaking changes** (no bump):
- Adding optional fields to `ScribePlugin`
- Bug fixes in plugin runtime processing
- Internal app changes that don't affect the plugin API

## Examples

### Wake Lock (Effect + config)

```typescript
import { useEffect } from 'react'
import { ScribePlugin, PluginConfig } from 'scribe-react-common/src/plugins/types'

function WakeLockEffect() {
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null
    async function acquire() {
      try { sentinel = await navigator.wakeLock.request('screen') }
      catch { /* not supported or denied */ }
    }
    acquire()
    const onVisChange = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', onVisChange)
    return () => {
      sentinel?.release()
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [])
  return null
}

export default function wakeLock(config: PluginConfig): ScribePlugin {
  const mode = config.mode ?? 'always' // "always" | "directive"
  return {
    name: 'wake-lock',
    apiVersion: 1,
    Effect: mode === 'always' ? WakeLockEffect : undefined,
  }
}
```

Config: `{ "mode": "always" }` keeps screen on for all notes. `{ "mode": "directive" }` only when a `<!-- wake-lock -->` directive is present.

### Guitar Tab Editor (micromark + mounts)

```typescript
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
    mounts: [{
      selector: '[data-plugin-tabs]',
      Component: ({ element }) => {
        const content = element.getAttribute('data-content') ?? ''
        return <TabEditor initialContent={content} />
      },
    }],
  }
}
```

The micromark extension parses `` ```tabs `` fenced code blocks into `<div data-plugin-tabs data-content="...">` placeholders. The mount replaces each with the React tab editor.

### Math Rendering (micromark only)

```typescript
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

## Testing

A plugin factory returns a plain object. Test each piece independently:

- **Micromark extensions**: input markdown → output HTML
- **React components**: render with React Testing Library
- **Effects**: standard React hook testing
- **Factory**: verify different config values produce expected plugin shapes

## Plugin-to-Plugin Isolation

Plugins compose but are not aware of each other.

| Conflict | Resolution |
|---|---|
| Two micromark extensions claim the same syntax | First match wins. Use namespaced syntax (e.g. `` ```tabs ``) |
| Two plugins mount to the same selector | Both mount. Use `[data-plugin-NAME]` convention |
| Overlapping CodeMirror keymaps | CodeMirror's `keymap` facet precedence. Use `Prec.high()` / `Prec.low()` |
| Conflicting `transformHtml` | Compose in plugin order. Be additive, not destructive |
