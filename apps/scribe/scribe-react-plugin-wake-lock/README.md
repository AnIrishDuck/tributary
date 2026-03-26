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

## Using in scribe

1. Build the plugin (or host the built file on any URL)
2. In a scribe library's plugin settings, add the URL to `dist/wake-lock.js`
3. Optionally set config `{"top": "false"}` to place the button at the bottom

## How it works (for plugin authors)

This plugin uses two parts of the scribe plugin API:

- **`transformHtml`** — injects a `<div data-plugin-wake-lock>` placeholder into the rendered markdown HTML (after the first heading, or at the end)
- **`mounts`** — renders a React component (`WakeLockButton`) into elements matching the `[data-plugin-wake-lock]` selector

See [docs/plugins.md](../docs/plugins.md) for the full plugin author guide.
