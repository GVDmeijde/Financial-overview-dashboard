import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer, get } from 'node:http'
import { createApiHandler, loadImports, readCategorization } from '../server/api.js'
import { createAppServer } from '../server/index.js'

const csv = '"IBAN/BBAN","Munt","Volgnr","Datum","Bedrag","Saldo na trn"\n"NL01","EUR","1","2025-01-01","+25,00","+25,00"'

test('production server serves only built assets and retains the local API security checks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'financial-production-'))
  const staticDirectory = path.join(root, 'dist')
  const importDirectory = path.join(root, 'import')
  const categoryFile = path.join(root, 'data', 'categories.json')
  await mkdir(staticDirectory)
  await mkdir(importDirectory)
  await writeFile(path.join(staticDirectory, 'index.html'), '<!doctype html><title>Financial Overview</title>')
  await writeFile(path.join(staticDirectory, 'app.js'), 'console.log("dashboard")')
  await writeFile(path.join(importDirectory, 'bank.csv'), csv)
  const server = createAppServer({ staticDirectory, importDirectory, categoryFile })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const page = await fetch(base)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type'), /text\/html/)
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
    assert.match(await page.text(), /Financial Overview/)
    assert.match((await fetch(`${base}/app.js`)).headers.get('content-type'), /javascript/)
    assert.equal((await (await fetch(`${base}/api/data`)).json()).transactions.length, 1)
    assert.equal((await fetch(`${base}/api/data`, { headers: { Origin: 'https://example.com' } })).status, 403)
    const remoteHostStatus = await new Promise((resolve, reject) => get(`${base}/api/data`, { headers: { Host: 'example.com' } }, (response) => { response.resume(); resolve(response.statusCode) }).on('error', reject))
    assert.equal(remoteHostStatus, 403)
    assert.equal((await fetch(`${base}/api/unknown`)).status, 404)
    assert.equal((await fetch(`${base}/import/bank.csv`)).status, 404)
    assert.equal((await fetch(`${base}/server/api.js`)).status, 404)
    assert.equal((await fetch(`${base}/%2e%2e%2fimport/bank.csv`)).status, 404)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('local API imports, deduplicates, rescans, and rejects unsafe or invalid uploads', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'financial-overview-'))
  const server = createServer(createApiHandler(directory, path.join(directory, 'app-data', 'categories.json')))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const send = (name, body = csv, extraHeaders = {}) => fetch(`${base}/api/import`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), ...extraHeaders }, body,
  })
  try {
    assert.equal((await (await fetch(`${base}/api/data`)).json()).transactions.length, 0)
    const result = await send('bank.csv')
    assert.equal(result.status, 200)
    assert.equal((await result.json()).added, 1)
    assert.equal((await (await send('duplicate.csv')).json()).added, 0)
    assert.deepEqual(await readdir(directory), ['bank.csv'])
    assert.equal((await send('../outside.csv')).status, 400)
    assert.equal((await send('bad.csv', 'not a CSV')).status, 422)
    assert.equal((await send('cross.csv', csv, { Origin: 'https://example.com' })).status, 403)
    assert.equal((await send('conflict.csv', csv.replace('+25,00', '+30,00'))).status, 409)
    await writeFile(path.join(directory, 'broken.csv'), 'bad data')
    const data = await loadImports(directory)
    assert.equal(data.transactions.length, 1)
    assert.ok(data.files.find((file) => file.name === 'broken.csv').error)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})

test('tags persist across server restarts and bulk edits never change bank exports or categories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'financial-tags-'))
  const directory = path.join(root, 'import')
  const categoryFile = path.join(root, 'data', 'categories.json')
  const source = `${csv}\n"NL01","EUR","2","2025-01-02","-5,00","+20,00"`
  await mkdir(directory)
  await writeFile(path.join(directory, 'bank.csv'), source)
  let server
  const start = async () => {
    server = createServer(createApiHandler(directory, categoryFile))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    return `http://127.0.0.1:${server.address().port}`
  }
  let base = await start()
  const read = async () => (await fetch(`${base}/api/data`)).json()
  const send = (command) => fetch(`${base}/api/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) })
  try {
    const initial = await read()
    const ids = initial.transactions.map((transaction) => transaction.id)
    const created = await send({ revision: 0, action: 'saveTag', tag: { name: 'Holiday' }, transactionIds: [ids[0]] })
    assert.equal(created.status, 200)
    const saved = await created.json()
    const tagId = saved.tags[0].id
    assert.deepEqual(saved.transactionTags[ids[0]], [tagId])
    const bulk = await send({ revision: 1, action: 'tagTransactions', operation: 'add', tagId, transactionIds: ids })
    assert.equal(bulk.status, 200)
    const expected = await bulk.json()
    await new Promise((resolve) => server.close(resolve))
    base = await start()
    const restarted = await read()
    assert.deepEqual(restarted.categorization, expected)
    assert.deepEqual(restarted.categorization.categories, initial.categorization.categories)
    assert.deepEqual(restarted.categorization.rules, initial.categorization.rules)
    assert.deepEqual(restarted.categorization.assignments, initial.categorization.assignments)
    assert.equal((await send({ revision: 1, action: 'deleteTag', id: tagId })).status, 409)
    assert.equal((await send({ revision: 2, action: 'saveTag', tag: { name: ' holiday ' } })).status, 400)
    assert.equal((await readCategorization(categoryFile)).revision, 2)
    const removed = await send({ revision: 2, action: 'tagTransactions', operation: 'remove', tagId, transactionIds: ids })
    assert.equal(removed.status, 200)
    assert.deepEqual((await removed.json()).transactionTags, {})
    assert.equal(await readFile(path.join(directory, 'bank.csv'), 'utf8'), source)
    assert.deepEqual(await readdir(directory), ['bank.csv'])
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('categories persist outside the import folder and never modify bank CSVs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'financial-categories-'))
  const directory = path.join(root, 'import')
  const categoryFile = path.join(root, 'app-data', 'categories.json')
  await mkdir(directory)
  await writeFile(path.join(directory, 'bank.csv'), csv)
  const server = createServer(createApiHandler(directory, categoryFile))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const send = (command, extraHeaders = {}) => fetch(`${base}/api/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(command) })
  try {
    const initial = await (await fetch(`${base}/api/data`)).json()
    assert.equal(initial.categorization.revision, 0)
    const id = initial.transactions[0].id
    const assignment = { revision: 0, action: 'assign', transactionIds: [id], categoryId: 'insurance' }
    const response = await send(assignment)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).assignments[id], 'insurance')
    assert.equal((await readCategorization(categoryFile)).assignments[id], 'insurance')
    const reloaded = await (await fetch(`${base}/api/data`)).json()
    assert.equal(reloaded.categorization.assignments[reloaded.transactions[0].id], 'insurance')
    assert.equal(await readFile(path.join(directory, 'bank.csv'), 'utf8'), csv)
    assert.deepEqual(await readdir(directory), ['bank.csv'])
    assert.equal((await send(assignment)).status, 409)
    assert.equal((await send({ ...assignment, revision: 1, categoryId: 'not-a-category' })).status, 400)
    assert.equal((await send({ ...assignment, revision: 1 }, { Origin: 'https://example.com' })).status, 403)
    assert.equal((await readCategorization(categoryFile)).revision, 1)
    const regexRule = { categoryId: 'groceries', field: 'counterparty', direction: 'out', matchType: 'regex', value: '^AH\\s+' }
    const savedRule = await send({ revision: 1, action: 'saveRule', rule: regexRule })
    assert.equal(savedRule.status, 200)
    assert.equal((await savedRule.json()).rules[0].value, regexRule.value)
    const regexReload = await (await fetch(`${base}/api/data`)).json()
    assert.equal(regexReload.categorization.rules[0].matchType, 'regex')
    assert.equal(regexReload.categorization.rules[0].value, regexRule.value)
    const invalidRule = await send({ revision: 2, action: 'saveRule', rule: { ...regexRule, value: '(' } })
    assert.equal(invalidRule.status, 400)
    assert.match((await invalidRule.json()).error, /Invalid regex/)
    assert.equal((await readCategorization(categoryFile)).revision, 2)
    assert.equal(await readFile(path.join(directory, 'bank.csv'), 'utf8'), csv)
    await writeFile(categoryFile, 'corrupt metadata')
    assert.equal((await send({ ...assignment, revision: 2 })).status, 500)
    assert.equal(await readFile(categoryFile, 'utf8'), 'corrupt metadata')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})