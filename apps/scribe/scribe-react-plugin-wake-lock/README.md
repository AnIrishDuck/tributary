# scribe-react-plugin-wake-lock

Demo scribe plugin that keeps the screen awake on mobile using the [Screen Wake Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API). Useful as a reference for how to build, test, and publish a scribe plugin.

## What it does

- Injects a toggle button into the rendered note showing wake lock status (on/off)
- Acquires a wake lock on mount (defaults to on)
- Re-acquires automatically when the page becomes visible again
- Shows "unsupported" on browsers without the Wake Lock API

## Configuration

| Key   | Values          | Default  | Effect |
|-------|-----------------|----------|--------|
| `top` | `"true"` / `"false"` | `"true"` | `"true"`: button appears after the first heading. `"false"`: button appears at the end of the note. |

## Building

```sh
npm run build
```

Produces `dist/wake-lock.js` — a standalone ES module with `react` and `react/jsx-runtime` externalized. The host app's import map resolves those at runtime so the plugin shares the same React instance.

## Testing

```sh
npm test
```

## Publishing

For small single-file bundles, you can publish via a GitHub gist:

```sh
npm run build
gh gist create --public dist/wake-lock.js
```

Use the **raw** URL from the gist (the `gist.githubusercontent.com` URL, not the HTML page) as the plugin URL in scribe. For larger plugins with multiple files, host the built output on a CDN or static file server.

## Using in scribe

1. Build and publish the plugin (see above)
2. In a scribe library's plugin settings, add the raw URL
3. Optionally set config `{"top": "false"}` to place the button at the bottom

## How it works (for plugin authors)

This plugin uses two parts of the scribe plugin API:

- **`transformHtml`** — injects a `<div data-plugin-wake-lock>` placeholder into the rendered markdown HTML (after the first heading, or at the end)
- **`mounts`** — renders a React component (`WakeLockButton`) into elements matching the `[data-plugin-wake-lock]` selector

See [docs/plugins.md](../docs/plugins.md) for the full plugin author guide.
