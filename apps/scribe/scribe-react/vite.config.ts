import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // This is needed for test environment to work properly
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development')
  },
  server: {
    // Critical for security - no sensitive data should be sent to server
    // All key material must stay client-side
    host: '127.0.0.1',
    port: 3000
  }
})
