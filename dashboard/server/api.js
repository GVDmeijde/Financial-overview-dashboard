import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { decodeCsv, mergeImports, parseCsv } from '../src/finance.js'
import { emptyCategorization, updateCategorization, validateCategorization } from '../src/categories.js'

const maxFileSize = 20 * 1024 * 1024
const httpError = (status, message) => Object.assign(new Error(message), { status })

export async function loadImports(directory) {
  await mkdir(directory, { recursive: true })
  const entries = await readdir(directory, { withFileTypes: true })
  const names = entries.filter((entry) => entry.isFile() && /\.csv$/i.test(entry.name)).map((entry) => entry.name).sort()
  const batches = await Promise.all(names.map(async (name) => {
    try {
      if ((await stat(path.join(directory, name))).size > maxFileSize) throw new Error('File exceeds the 20 MB limit')
      const warnings = []
      const transactions = parseCsv(decodeCsv(await readFile(path.join(directory, name))), name, (warning) => warnings.push(warning))
      return { name, transactions, warnings }
    } catch (error) {
      return { name, error: error.message }
    }
  }))
  return { ...mergeImports(batches), scannedAt: new Date().toISOString() }
}

async function upload(req, directory) {
  let name
  try {
    name = decodeURIComponent(req.headers['x-file-name'] || '')
  } catch {
    throw httpError(400, 'Invalid file name')
  }
  if (!name || name.length > 180 || name !== path.basename(name) || /[\\/:]/.test(name) || [...name].some((character) => character.charCodeAt(0) < 32) || name.startsWith('.') || !/\.csv$/i.test(name)) {
    throw httpError(400, 'Choose a CSV file with a valid file name')
  }
  if (req.headers['content-type'] !== 'application/octet-stream') throw httpError(415, 'Expected a CSV file upload')
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxFileSize) throw httpError(413, 'File exceeds the 20 MB limit')
    chunks.push(chunk)
  }
  const buffer = Buffer.concat(chunks)
  let transactions
  try {
    transactions = parseCsv(decodeCsv(buffer), name)
  } catch (error) {
    throw httpError(422, error.message)
  }
  const current = await loadImports(directory)
  const candidate = mergeImports([{ name: 'existing', transactions: current.transactions }, { name, transactions }]).files.at(-1)
  if (candidate.error) throw httpError(409, candidate.error)
  if (!candidate.added) return { message: 'All transactions already imported', added: 0 }
  await mkdir(directory, { recursive: true })
  try {
    await writeFile(path.join(directory, name), buffer, { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    name = `${name.slice(0, -4)}-${randomUUID().slice(0, 8)}.csv`
    await writeFile(path.join(directory, name), buffer, { flag: 'wx' })
  }
  return { message: `Imported ${candidate.added.toLocaleString()} transactions`, added: candidate.added, name }
}

export async function readCategorization(file) {
  try {
    return validateCategorization(JSON.parse(await readFile(file, 'utf8')))
  } catch (error) {
    if (error.code === 'ENOENT') return emptyCategorization()
    throw httpError(500, 'Unable to read category data. Check or restore the app data file; it has not been overwritten.')
  }
}

async function saveCategorization(req, directory, file) {
  if (req.headers['content-type'] !== 'application/json') throw httpError(415, 'Expected JSON')
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw httpError(413, 'Category request exceeds the 1 MB limit')
    chunks.push(chunk)
  }
  let next
  try {
    const command = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const state = await readCategorization(file)
    const data = await loadImports(directory)
    next = updateCategorization(state, command, data.transactions, randomUUID)
  } catch (error) {
    throw httpError(error.status || 400, error.message)
  }
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 })
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
  return next
}

export function createApiHandler(directory, categoryFile = fileURLToPath(new URL('../data/categories.json', import.meta.url))) {
  let updates = Promise.resolve()
  return (req, res, next = () => { res.statusCode = 404; res.end() }) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    if (!pathname.startsWith('/api/')) return next()
    const respond = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      res.end(JSON.stringify(data))
    }
    const handle = async () => {
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(req.headers.host || '') || req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
        throw httpError(403, 'Only local, same-origin requests are allowed')
      }
      if (pathname === '/api/data' && req.method === 'GET') return respond(200, { ...await loadImports(directory), categorization: await readCategorization(categoryFile) })
      if (pathname === '/api/import' && req.method === 'POST') return respond(200, await upload(req, directory))
      if (pathname === '/api/categories' && req.method === 'POST') {
        const update = updates.then(() => saveCategorization(req, directory, categoryFile))
        updates = update.catch(() => {})
        return respond(200, await update)
      }
      respond(404, { error: 'Endpoint not found' })
    }
    handle().catch((error) => respond(error.status || 500, { error: error.status ? error.message : 'Unable to access the import folder' }))
  }
}