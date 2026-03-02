import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      'scribe-data': path.resolve(__dirname, '../scribe-data/src'),
      'tributary-client/cli': path.resolve(__dirname, '../../../tributary-client/src/cliUtils.ts'),
      'tributary-client': path.resolve(__dirname, '../../../tributary-client/src'),
    },
  },
  test: {
    testTimeout: 30000,
    globals: true,
  },
})
