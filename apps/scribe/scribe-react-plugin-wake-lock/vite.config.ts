import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: 'src/index.tsx',
      formats: ['es'],
      fileName: 'wake-lock',
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime'],
    },
  },
})
