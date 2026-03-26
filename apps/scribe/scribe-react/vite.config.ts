import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// React is loaded from esm.sh via import map (see index.html) so that
// dynamically-loaded plugins share the exact same React instance as the host.
// Plugins are ES modules that externalize react in their builds and rely on
// the browser's import map for resolution.
const REACT_ESM = 'https://esm.sh/react@18.3.1'
const REACT_EXTERNALS = ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client']

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Precache all build assets including PGlite WASM files
        globPatterns: ['**/*.{js,css,html,svg,png,wasm,data}'],
        // Increase max file size for PGlite WASM/data files
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
      },
      manifest: {
        name: 'Scribe - Encrypted Document Editor',
        short_name: 'Scribe',
        description: 'End-to-end encrypted document editor with local-first storage',
        theme_color: '#2563eb',
        background_color: '#f9fafb',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  define: {
    // This is needed for test environment to work properly
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
  },
  resolve: {
    alias: {
      // Polyfill Buffer for browser compatibility
      buffer: 'buffer/',
      // Point react imports to esm.sh so the host uses the same instance
      // the browser import map provides to plugins
      'react/jsx-runtime': `${REACT_ESM}/jsx-runtime`,
      'react-dom/client': 'https://esm.sh/react-dom@18.3.1/client',
      'react-dom': 'https://esm.sh/react-dom@18.3.1',
      'react': REACT_ESM,
    }
  },
  build: {
    rollupOptions: {
      // Leave react as bare imports — resolved by the import map at runtime
      external: REACT_EXTERNALS,
    },
  },
  server: {
    // Bind to all interfaces for external access
    // Security: All key material stays in URL hash (client-side only)
    host: '0.0.0.0',
    port: 3000
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // Exclude PGlite from optimization to prevent WASM loading issues
    exclude: ['@electric-sql/pglite'],
    // Force include buffer polyfill
    include: ['buffer'],
    esbuildOptions: {
      // Prevent esbuild from bundling react into pre-bundled deps (e.g.
      // react-router).  Left as bare imports, they're resolved by the
      // resolve.alias in dev and the import map in production.
      plugins: [{
        name: 'externalize-react',
        setup(build) {
          build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({
            path: args.path,
            external: true,
          }))
        },
      }],
    },
  }
})
