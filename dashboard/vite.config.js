import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import { createApiHandler } from './server/api.js'

const directory = fileURLToPath(new URL('../import/', import.meta.url))

export default defineConfig({
  plugins: [react(), {
    name: 'local-financial-api',
    configureServer(server) { server.middlewares.use(createApiHandler(directory)) },
    configurePreviewServer(server) { server.middlewares.use(createApiHandler(directory)) },
  }],
  server: { host: '127.0.0.1', watch: { usePolling: true, interval: 500 } },
  preview: { host: '127.0.0.1' },
})
