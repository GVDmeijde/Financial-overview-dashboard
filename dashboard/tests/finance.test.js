import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { balanceTimeline, decodeCsv, findInternalTransfers, getAccounts, mergeImports, parseCsv, parseMoney, summarizePeriod } from '../src/finance.js'
import { categorySummary, emptyCategorization, merchantSummary } from '../src/categories.js'

const header = '"IBAN/BBAN","Munt","Volgnr","Datum","Bedrag","Saldo na trn","Naam tegenpartij","Omschrijving-1"'
const csv = `${header}\n"NL01","EUR","0002","2025-01-02","-2,50","+97,50","Shop","Food, coffee"\n"NL01","EUR","0001","2025-01-01","+100,00","+100,00","Employer","Salary"\n"NL01","EUR","0003","2025-01-02","+5,00","+102,50","Friend","Refund"`

test('parses Dutch amounts as exact cents', () => {
  assert.equal(parseMoney('-1.234,56'), -123456)
  assert.equal(parseMoney('+0,01'), 1)
  assert.throws(() => parseMoney('1.23'))
  assert.throws(() => parseMoney(''))
})

test('parses quoted fields and sorts by date and numeric sequence', () => {
  const parsed = parseCsv(csv, 'sample.csv')
  assert.equal(parsed[0].description, 'Food, coffee')
  const data = mergeImports([{ name: 'sample.csv', transactions: parsed }])
  assert.deepEqual(data.transactions.map((transaction) => transaction.sequence), ['1', '2', '3'])
  assert.equal(getAccounts(data.transactions)[0].balance, 10250)
  assert.equal(getAccounts(data.transactions)[0].opening, 0)
})

test('overlapping files are deduplicated and conflicts reject the entire file', () => {
  const parsed = parseCsv(csv, 'first.csv')
  const duplicate = parseCsv(csv, 'second.csv')
  const data = mergeImports([{ name: 'first.csv', transactions: parsed }, { name: 'second.csv', transactions: duplicate }])
  assert.equal(data.transactions.length, 3)
  assert.equal(data.files[1].duplicates, 3)
  const conflicted = mergeImports([{ name: 'first.csv', transactions: parsed }, { name: 'bad.csv', transactions: [{ ...duplicate[0], amount: 5 }] }])
  assert.match(conflicted.files[1].error, /Conflicting/)
  assert.equal(conflicted.transactions.length, 3)
})

test('balance history carries previous balances forward and retains final same-day balance', () => {
  const transactions = mergeImports([{ name: 'sample.csv', transactions: parseCsv(csv, 'sample.csv') }]).transactions
  const points = balanceTimeline(transactions, ['NL01:EUR'], '2025-01-02', '2025-01-04')
  assert.deepEqual(points, [{ date: '2025-01-02', 'NL01:EUR': 10250 }, { date: '2025-01-04', 'NL01:EUR': 10250 }])
  const period = summarizePeriod(transactions, ['NL01:EUR'], '2025-01-02', '2025-01-04')
  assert.equal(period.incoming, 500)
  assert.equal(period.outgoing, 250)
  assert.equal(balanceTimeline(transactions, ['NL01:EUR'], '2025-01-03', '2025-01-04')[0]['NL01:EUR'], 10250)
})

test('does not invent balances before an account first appears', () => {
  const transactions = parseCsv(csv, 'sample.csv')
  const points = balanceTimeline(transactions, ['NL01:EUR'], '2024-12-01', '2025-01-04')
  assert.equal(points[0]['NL01:EUR'], undefined)
})

test('rejects missing columns, impossible dates and malformed amounts', () => {
  assert.throws(() => parseCsv('date,amount\n2025-01-01,5', 'bad.csv'), /Missing columns/)
  assert.throws(() => parseCsv(csv.replace('2025-01-02', '2025-02-30'), 'bad.csv'), /Invalid transaction date/)
  assert.throws(() => parseCsv(csv.replace('-2,50', 'oops'), 'bad.csv'), /Row 2/)
})

test('decodes Windows-1252 exports', () => {
  assert.equal(decodeCsv(Uint8Array.from([67, 97, 102, 233])), 'Caf\u00e9')
})

test('recovers literal unescaped quotes without losing adjacent fields or rows', () => {
  const warnings = []
  const transactions = parseCsv(csv.replace('"Shop"', '"Shop "Example"'), 'quotes.csv', (warning) => warnings.push(warning))
  assert.equal(transactions.length, 3)
  assert.equal(transactions[0].counterparty, 'Shop "Example')
  assert.equal(transactions[0].description, 'Food, coffee')
  assert.equal(transactions[0].balance, 9750)
  assert.equal(warnings.length, 1)
})

test('imports the supplied export with exact recorded account balances', async () => {
  const buffer = await readFile(new URL('../../import/CSV_A_accounts_20231102_20261019.csv', import.meta.url))
  const parsed = parseCsv(decodeCsv(buffer), 'provided.csv')
  const data = mergeImports([{ name: 'provided.csv', transactions: parsed }])
  assert.ok(data.transactions.length > 0)
  for (const account of getAccounts(data.transactions)) {
    const latest = data.transactions.filter((transaction) => transaction.accountId === account.id).at(-1)
    assert.equal(account.balance, latest.balance)
    const timeline = balanceTimeline(data.transactions, [account.id], account.firstDate, account.lastDate)
    assert.equal(timeline.at(-1)[account.id], latest.balance)
  }
})

const transferTransactions = [
  { id: 'a1', account: 'NL01', accountId: 'NL01:EUR', currency: 'EUR', counterAccount: 'NL02', date: '2025-01-02', sequence: '1', amount: -10000, balance: 5000, counterparty: 'Savings transfer' },
  { id: 'b1', account: 'NL02', accountId: 'NL02:EUR', currency: 'EUR', counterAccount: 'NL01', date: '2025-01-03', sequence: '1', amount: 10000, balance: 10000, counterparty: 'Transfer in' },
  { id: 'a2', account: 'NL01', accountId: 'NL01:EUR', currency: 'EUR', counterAccount: 'NL99', date: '2025-01-02', sequence: '2', amount: -1250, balance: 3750, counterparty: 'Shop' },
  { id: 'a3', account: 'NL01', accountId: 'NL01:EUR', currency: 'EUR', counterAccount: 'NL01', date: '2025-01-02', sequence: '3', amount: -350, balance: 3400, counterparty: 'Bank fee' },
  { id: 'a4', account: 'NL01', accountId: 'NL01:EUR', currency: 'EUR', counterAccount: 'NL88', date: '2025-01-04', sequence: '4', amount: 20000, balance: 23400, counterparty: 'Employer' },
]

test('internal transfer detection uses account ownership, not names or amount matching', () => {
  const snapshot = structuredClone(transferTransactions)
  assert.deepEqual([...findInternalTransfers(transferTransactions)], ['a1', 'b1'])
  assert.deepEqual(transferTransactions, snapshot)
  const normalized = [{ ...transferTransactions[0], counterAccount: ' nl 02 ' }, { ...transferTransactions[1], account: 'nl02' }]
  assert.deepEqual([...findInternalTransfers(normalized)], ['a1', 'b1'])
  assert.equal(findInternalTransfers([{ ...transferTransactions[0], counterAccount: '' }]).size, 0)
  assert.equal(findInternalTransfers([{ ...transferTransactions[0], counterAccount: 'NL99', counterparty: 'Own account transfer' }]).size, 0)
})

test('spending and cash flow exclude both transfer legs while history and balances retain them', () => {
  const period = summarizePeriod(transferTransactions, ['NL01:EUR', 'NL02:EUR'], '2025-01-01', '2025-01-31')
  assert.equal(period.incoming, 20000)
  assert.equal(period.outgoing, 1600)
  assert.equal(period.transactions.length, 5)
  assert.equal(period.reportingTransactions.length, 3)
  assert.equal(period.internalTransfers.length, 2)
  assert.equal(period.transferIncoming, 10000)
  assert.equal(period.transferOutgoing, 10000)
  const timeline = balanceTimeline(transferTransactions, ['NL01:EUR', 'NL02:EUR'], '2025-01-01', '2025-01-31')
  assert.equal(timeline.at(-1)['NL01:EUR'], 23400)
  assert.equal(timeline.at(-1)['NL02:EUR'], 10000)
})

test('detection is independent of selected accounts and asymmetric date coverage', () => {
  const period = summarizePeriod(transferTransactions, ['NL01:EUR'], '2025-01-02', '2025-01-02')
  assert.equal(period.internalTransfers.length, 1)
  assert.equal(period.outgoing, 1600)
  assert.equal(period.incoming, 0)
  const inbound = summarizePeriod(transferTransactions, ['NL02:EUR'], '2025-01-03', '2025-01-03')
  assert.equal(inbound.incoming, 0)
  assert.equal(inbound.transferIncoming, 10000)
  const crossCurrency = [transferTransactions[0], { ...transferTransactions[1], currency: 'USD', accountId: 'NL02:USD' }]
  assert.equal(summarizePeriod(crossCurrency, ['NL01:EUR'], '2025-01-01', '2025-01-31').outgoing, 0)
})

test('category and merchant analytics exclude transfers even when manually categorized', () => {
  const state = { ...emptyCategorization(), assignments: Object.fromEntries(transferTransactions.map((transaction) => [transaction.id, 'groceries'])) }
  const period = summarizePeriod(transferTransactions, ['NL01:EUR', 'NL02:EUR'], '2025-01-01', '2025-01-31')
  const category = categorySummary(period.reportingTransactions, state).find((group) => group.id === 'groceries')
  const merchants = merchantSummary(period.reportingTransactions, state, 'groceries')
  assert.equal(category.outgoing, 1600)
  assert.equal(category.incoming, 20000)
  assert.equal(category.count, 3)
  assert.equal(merchants.reduce((sum, group) => sum + group.outgoing, 0), 1600)
  assert.equal(merchants.some((group) => group.name === 'Savings transfer'), false)
})