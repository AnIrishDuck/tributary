import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'test'),
    global: 'globalThis'
  },
  resolve: {
    alias: [
      { find: 'buffer', replacement: 'buffer/' },
      // Resolve bare 'scribe-data' to TS source so new exports are available without rebuilding dist
      { find: /^scribe-data$/, replacement: path.resolve(__dirname, '../scribe-data/src/index.ts') },
    ]
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
    include: ['buffer']
  },
  test: {
    environment: 'jsdom',
    setupFiles: 'scribe-react-common/tests/setup.ts',
    testTimeout: 30000,
    globals: true,
  },
})
