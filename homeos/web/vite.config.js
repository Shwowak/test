import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) return 'echarts'
      if (id.includes('node_modules/gridstack')) return 'gridstack'
      if (id.includes('node_modules/vue') || id.includes('node_modules/@vue') || id.includes('node_modules/@intlify')) return 'vue'
    } } },
  },
  server: { proxy: { '/api': { target: 'http://localhost:8080', ws: true } } },
})
