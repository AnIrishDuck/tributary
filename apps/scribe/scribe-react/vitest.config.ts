import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  define: {
    // This is needed for test environment to work properly
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'test'),
    // Provide global for browser compatibility
    global: 'globalThis'
  },
  resolve: {
    alias: [
      // Polyfill Buffer for browser compatibility
      { find: 'buffer', replacement: 'buffer/' },
      // Resolve bare 'scribe-data' to TS source so new exports are available without rebuilding dist
      { find: /^scribe-data$/, replacement: path.resolve(__dirname, '../scribe-data/src/index.ts') },
      // Resolve scribe-react-sync to TS source (transitive dep via scribe-react-common)
      { find: /^scribe-react-sync\/src\/(.*)$/, replacement: path.resolve(__dirname, '../scribe-react-sync/src/$1') },
      { find: /^scribe-react-sync$/, replacement: path.resolve(__dirname, '../scribe-react-sync/src/index.ts') },
    ]
  },
  optimizeDeps: {
    // Exclude PGlite from optimization to prevent WASM loading issues
    exclude: ['@electric-sql/pglite'],
    // Force include buffer polyfill
    include: ['buffer']
  },
  test: {
    environment: 'jsdom',
    setupFiles: 'scribe-react-common/tests/setup.ts',
    testTimeout: 30000,
    globals: true,
  },
})
