import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'test'),
  },
  resolve: {
    alias: [
      // Resolve bare 'scribe-data' to TS source so new exports are available without rebuilding dist
      { find: /^scribe-data$/, replacement: path.resolve(__dirname, '../scribe-data/src/index.ts') },
    ]
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  test: {
    testTimeout: 30000,
    globals: true,
  },
})
