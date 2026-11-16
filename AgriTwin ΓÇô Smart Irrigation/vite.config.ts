import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// Standard Vite Configuration for AgriTwin
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 8443,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8768',
        changeOrigin: true,
      },
      '/visualization.html': {
        target: 'http://127.0.0.1:8768',
        changeOrigin: true,
      },
      '/visualization-3d.js': {
        target: 'http://127.0.0.1:8768',
        changeOrigin: true,
      },
    },
  },
})
