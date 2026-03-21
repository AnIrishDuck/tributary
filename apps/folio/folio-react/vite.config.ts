import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Vite configuration - https://vite.dev/config/
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
        name: 'Folio - Encrypted Document Editor',
        short_name: 'Folio',
        description: 'End-to-end encrypted document editor with local-first storage',
        theme_color: '#7c3aed',
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
    port: 3001
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
