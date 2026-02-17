import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  define: {
    // This is needed for test environment to work properly
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'test'),
    // Provide global for browser compatibility
    global: 'globalThis'
  },
  resolve: {
    alias: {
      // Polyfill Buffer for browser compatibility
      buffer: 'buffer/'
    }
  },
  optimizeDeps: {
    // Exclude PGlite from optimization to prevent WASM loading issues
    exclude: ['@electric-sql/pglite'],
    // Force include buffer polyfill
    include: ['buffer']
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    testTimeout: 30000,
    globals: true,
  },
})
