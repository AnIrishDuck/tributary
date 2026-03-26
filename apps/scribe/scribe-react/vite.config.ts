import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

/**
 * Dev-only Vite plugin that serves scribe plugin sources through Vite's
 * transform pipeline. This lets dynamically-imported plugins resolve bare
 * specifiers (e.g. "react") via Vite's pre-bundled deps — guaranteeing a
 * single React instance so hooks work correctly.
 *
 * Usage: add a plugin URL like "/dev-plugins/wake-lock.js" in library settings.
 */
function serveDevPlugins(): Plugin {
  const pluginSources: Record<string, string> = {
    'wake-lock.js': path.resolve(__dirname, '../scribe-react-plugin-wake-lock/src/index.tsx'),
  }

  return {
    name: 'serve-dev-plugins',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/dev-plugins/')) return next()
        const name = req.url.replace('/dev-plugins/', '').split('?')[0]
        const sourcePath = pluginSources[name]
        if (!sourcePath) return next()

        try {
          const result = await server.transformRequest('/@fs/' + sourcePath)
          if (result) {
            res.setHeader('Content-Type', 'application/javascript')
            res.setHeader('Cache-Control', 'no-cache')
            res.end(result.code)
            return
          }
        } catch (err) {
          console.error(`[dev-plugins] Failed to transform ${name}:`, err)
        }
        next()
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    serveDevPlugins(),
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
      buffer: 'buffer/'
    }
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
    include: ['buffer']
  }
})
