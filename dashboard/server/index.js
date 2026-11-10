import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sirv from 'sirv'
import { createApiHandler } from './api.js'

export function createAppServer({
  staticDirectory = fileURLToPath(new URL('../dist/', import.meta.url)),
  importDirectory = fileURLToPath(new URL('../../import/', import.meta.url)),
  categoryFile = fileURLToPath(new URL('../data/categories.json', import.meta.url)),
} = {}) {
  const api = createApiHandler(importDirectory, categoryFile)
  const assets = sirv(staticDirectory, { etag: true })
  return createServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    api(request, response, () => assets(request, response, () => {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
    }))
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1'
  const port = Number(process.env.PORT || 3000)
  const server = createAppServer()
  server.listen(port, host, () => console.log(`Financial Overview listening on ${host}:${port}`))
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close())
}