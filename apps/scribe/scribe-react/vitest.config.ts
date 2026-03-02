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
    alias: {
      // Polyfill Buffer for browser compatibility
      buffer: 'buffer/',
      // Deduplicate React and react-router so sub-packages (scribe-react-common,
      // scribe-react-note) use the same instances as scribe-react
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
      'react-router': path.resolve(__dirname, 'node_modules/react-router'),
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
