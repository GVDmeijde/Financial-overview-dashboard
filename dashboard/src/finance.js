import Papa from 'papaparse'

const requiredHeaders = ['IBAN/BBAN', 'Munt', 'Volgnr', 'Datum', 'Bedrag', 'Saldo na trn']

export function parseMoney(value) {
  const normalized = String(value ?? '').trim().replace(/\./g, '')
  if (!/^[+-]?\d+,\d{2}$/.test(normalized)) throw new Error(`Invalid monetary amount: ${value}`)
  const cents = Number(normalized.replace(',', ''))
  if (!Number.isSafeInteger(cents)) throw new Error('Monetary amount is too large')
  return cents
}

export function decodeCsv(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

export function parseCsv(text, source, onWarning = () => {}) {
  const result = Papa.parse(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  })
  const fatalErrors = result.errors.filter((error) => error.code !== 'InvalidQuotes')
  if (fatalErrors.length) throw new Error(`CSV error: ${fatalErrors[0].message}`)
  if (result.errors.length) onWarning(`${result.errors.length} unescaped quote(s) recovered in CSV fields`)
  const missing = requiredHeaders.filter((header) => !result.meta.fields?.includes(header))
  if (missing.length) throw new Error(`Missing columns: ${missing.join(', ')}`)
  if (!result.data.length) throw new Error('The CSV contains no transactions')
  return result.data.map((row, index) => {
    try {
      const account = row['IBAN/BBAN'].trim()
      const currency = row.Munt.trim().toUpperCase()
      const sequence = row.Volgnr.trim()
      const date = row.Datum.trim()
      if (!account || !/^\d+$/.test(sequence)) throw new Error('Missing account or invalid sequence number')
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid currency')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) {
        throw new Error('Invalid transaction date')
      }
      const accountId = `${account}:${currency}`
      return {
        id: `${accountId}:${BigInt(sequence)}`,
        accountId,
        account,
        currency,
        sequence: BigInt(sequence).toString(),
        date,
        amount: parseMoney(row.Bedrag),
        balance: parseMoney(row['Saldo na trn']),
        counterparty: row['Naam tegenpartij']?.trim() || '',
        counterAccount: row['Tegenrekening IBAN/BBAN']?.trim() || '',
        description: ['Omschrijving-1', 'Omschrijving-2', 'Omschrijving-3'].map((field) => row[field]?.trim()).filter(Boolean).join(' '),
        source,
      }
    } catch (error) {
      throw new Error(`Row ${index + 2}: ${error.message}`)
    }
  })
}

export function compareTransactions(left, right) {
  return left.date.localeCompare(right.date) || (BigInt(left.sequence) < BigInt(right.sequence) ? -1 : BigInt(left.sequence) > BigInt(right.sequence) ? 1 : 0) || left.accountId.localeCompare(right.accountId)
}

export function mergeImports(batches) {
  const unique = new Map()
  const files = []
  for (const batch of batches) {
    if (batch.error) {
      files.push({ name: batch.name, error: batch.error, added: 0, duplicates: 0 })
      continue
    }
    const pending = new Map()
    let duplicates = 0
    let error = null
    for (const transaction of batch.transactions) {
      const previous = pending.get(transaction.id) || unique.get(transaction.id)
      if (previous) {
        const { source: _previousSource, ...previousData } = previous
        const { source: _currentSource, ...currentData } = transaction
        if (JSON.stringify(previousData) !== JSON.stringify(currentData)) {
          error = `Conflicting transaction ${transaction.sequence} for ${transaction.account}; file not imported`
          break
        }
        duplicates++
      } else {
        pending.set(transaction.id, transaction)
      }
    }
    if (!error) for (const [id, transaction] of pending) unique.set(id, transaction)
    files.push({ name: batch.name, added: error ? 0 : pending.size, duplicates: error ? 0 : duplicates, error, warnings: batch.warnings || [] })
  }
  const transactions = [...unique.values()].sort(compareTransactions)
  return { transactions, files }
}

export function getAccounts(transactions) {
  const accounts = new Map()
  for (const transaction of [...transactions].sort(compareTransactions)) {
    let account = accounts.get(transaction.accountId)
    if (!account) {
      account = { id: transaction.accountId, iban: transaction.account, currency: transaction.currency, firstDate: transaction.date, opening: transaction.balance - transaction.amount, count: 0 }
      accounts.set(account.id, account)
    }
    account.balance = transaction.balance
    account.lastDate = transaction.date
    account.count++
  }
  return [...accounts.values()]
}

export function balanceTimeline(transactions, accountIds, start, end) {
  if (!start || !end || start > end) return []
  const selected = transactions.filter((transaction) => accountIds.includes(transaction.accountId)).sort(compareTransactions)
  const dates = new Map()
  for (const transaction of selected) {
    if (transaction.date > end) continue
    if (transaction.date >= start) {
      if (!dates.has(transaction.date)) dates.set(transaction.date, [])
      dates.get(transaction.date).push(transaction)
    }
  }
  const points = []
  const running = {}
  for (const transaction of selected) {
    if (transaction.date < start) running[transaction.accountId] = transaction.balance
  }
  points.push({ date: start, ...running })
  for (const [date, daily] of dates) {
    for (const transaction of daily) running[transaction.accountId] = transaction.balance
    const point = { date, ...running }
    if (points.at(-1).date === date) points[points.length - 1] = point
    else points.push(point)
  }
  if (points.at(-1).date !== end) points.push({ date: end, ...running })
  return points
}

export function findInternalTransfers(transactions, accountIds = transactions.map((transaction) => transaction.accountId)) {
  const normalizeAccount = (value) => String(value || '').replace(/\s/g, '').toUpperCase()
  const selectedIds = new Set(accountIds)
  const selectedTransactions = transactions.filter((transaction) => selectedIds.has(transaction.accountId))
  const selectedAccounts = new Set(selectedTransactions.map((transaction) => normalizeAccount(transaction.account)).filter(Boolean))
  return new Set(selectedTransactions.filter((transaction) => {
    const account = normalizeAccount(transaction.account)
    const counterAccount = normalizeAccount(transaction.counterAccount)
    return counterAccount && counterAccount !== account && selectedAccounts.has(counterAccount)
  }).map((transaction) => transaction.id))
}

export function chartInterval(start, end, preset = 'CUSTOM') {
  if (preset === '1') return 'day'
  if (preset === '3') return 'week'
  if (preset === '12' || preset === 'ALL') return 'month'
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1
  if (!Number.isFinite(days) || days < 1) return 'month'
  return days <= 31 ? 'day' : days <= 93 ? 'week' : 'month'
}

export function monthlyAverageMonths(start, end, preset = 'CUSTOM') {
  if (['1', '3', '12'].includes(preset)) return Number(preset)
  if (!start || !end || start > end) return 0
  const firstMonth = start.slice(0, 7).split('-').map(Number)
  const lastMonth = end.slice(0, 7).split('-').map(Number)
  return Math.max(1, (lastMonth[0] - firstMonth[0]) * 12 + lastMonth[1] - firstMonth[1] + 1)
}

export function chartBucketKey(date, interval) {
  if (interval === 'month') return date.slice(0, 7)
  if (interval === 'day') return date
  const monday = new Date(`${date}T00:00:00Z`)
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
  return monday.toISOString().slice(0, 10)
}

const chartPeriodFormatters = new Map()

export function formatChartPeriod(period, interval, detailed = false, locale = 'en-GB') {
  const date = new Date(`${period.length === 7 ? `${period}-01` : period}T00:00:00Z`)
  const key = `${locale}:${interval}:${detailed}`
  if (!chartPeriodFormatters.has(key)) {
    const options = interval === 'month'
      ? { month: detailed ? 'long' : 'short', year: detailed ? 'numeric' : '2-digit' }
      : { day: 'numeric', month: detailed ? 'long' : 'short', ...(detailed ? { year: 'numeric' } : {}) }
    chartPeriodFormatters.set(key, new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }))
  }
  const label = chartPeriodFormatters.get(key).format(date)
  return interval === 'week' && detailed ? `${locale.startsWith('nl') ? 'Week van' : 'Week of'} ${label}` : label
}

export function cashflowByInterval(transactions, interval = 'month', start, end) {
  if (!transactions.length) return []
  const dates = transactions.map((transaction) => transaction.date).sort()
  const rangeStart = start || dates[0]
  const rangeEnd = end || dates.at(-1)
  if (!rangeStart || !rangeEnd || rangeStart > rangeEnd) return []
  const buckets = new Map()
  let key = chartBucketKey(rangeStart, interval)
  const finalKey = chartBucketKey(rangeEnd, interval)
  while (key <= finalKey) {
    buckets.set(key, { period: key, incoming: 0, outgoing: 0 })
    const next = new Date(`${key.length === 7 ? `${key}-01` : key}T00:00:00Z`)
    if (interval === 'month') next.setUTCMonth(next.getUTCMonth() + 1)
    else next.setUTCDate(next.getUTCDate() + (interval === 'week' ? 7 : 1))
    key = chartBucketKey(next.toISOString().slice(0, 10), interval)
  }
  for (const transaction of transactions) {
    if (transaction.date < rangeStart || transaction.date > rangeEnd) continue
    const bucket = buckets.get(chartBucketKey(transaction.date, interval))
    bucket[transaction.amount >= 0 ? 'incoming' : 'outgoing'] += Math.abs(transaction.amount)
  }
  return [...buckets.values()]
}

export function summarizePeriod(transactions, accountIds, start, end) {
  const internalTransferIds = findInternalTransfers(transactions, accountIds)
  const filtered = transactions.filter((transaction) => accountIds.includes(transaction.accountId) && transaction.date >= start && transaction.date <= end)
  const reportingTransactions = filtered.filter((transaction) => !internalTransferIds.has(transaction.id))
  const internalTransfers = filtered.filter((transaction) => internalTransferIds.has(transaction.id))
  return {
    transactions: filtered,
    reportingTransactions,
    internalTransfers,
    internalTransferIds,
    transferIncoming: internalTransfers.reduce((sum, transaction) => sum + Math.max(0, transaction.amount), 0),
    transferOutgoing: internalTransfers.reduce((sum, transaction) => sum + Math.max(0, -transaction.amount), 0),
    incoming: reportingTransactions.reduce((sum, transaction) => sum + Math.max(0, transaction.amount), 0),
    outgoing: reportingTransactions.reduce((sum, transaction) => sum + Math.max(0, -transaction.amount), 0),
  }
}