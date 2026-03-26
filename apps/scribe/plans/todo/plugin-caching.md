# Plugin System: Offline Caching

React is loaded from esm.sh via import map. The PWA service worker (workbox) precaches build assets but not these external URLs. If the user is offline and the esm.sh modules aren't in the browser's HTTP cache, the app will fail to load.

Options:

- **Runtime caching**: add workbox `runtimeCaching` rules for `esm.sh` so modules are cached on first load
- **Self-host React**: download the esm.sh bundles at build time, serve them from the app's own origin, and update the import map URLs to match — avoids any external dependency at runtime
