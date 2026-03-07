import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'test'),
    global: 'globalThis'
  },
  resolve: {
    alias: {
      buffer: 'buffer/'
    }
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
    include: ['buffer']
  },
  test: {
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
    testTimeout: 30000,
    globals: true,
  },
})
