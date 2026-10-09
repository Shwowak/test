import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 700,
  },
  server: { proxy: { '/api': { target: 'http://localhost:8080', ws: true } } },
})
