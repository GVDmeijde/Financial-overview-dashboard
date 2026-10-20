import { RE2JS } from 're2js'
import { cashflowByInterval, chartBucketKey } from './finance.js'

export const defaultCategories = [
  { id: 'groceries', name: 'Groceries', color: '#087f70' },
  { id: 'mortgage', name: 'Mortgage', color: '#4285d4' },
  { id: 'insurance', name: 'Insurance', color: '#bd7b12' },
  { id: 'subscriptions', name: 'Subscriptions', color: '#bb5274' },
]

export function emptyCategorization() {
  return { revision: 0, categories: defaultCategories.map((category) => ({ ...category })), rules: [], assignments: {} }
}

const normalize = (value) => value.normalize('NFKC').trim().toLocaleLowerCase('en-GB')
const filterCache = new Map()
const ruleFilterCache = new WeakMap()

export function compileFilter(pattern, matchType = 'text', exact = false) {
  const key = JSON.stringify([pattern, matchType, exact])
  if (filterCache.has(key)) return filterCache.get(key)
  let filter
  try {
    if (!['text', 'regex'].includes(matchType)) throw new Error('Unknown match type')
    if (matchType === 'regex') {
      if (pattern.length > 200) throw new Error('Regex patterns must be 200 characters or fewer')
      const expression = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE)
      filter = { test: (value) => Boolean(pattern) && expression.matcher(value).find(), error: '' }
    } else {
      const match = normalize(pattern)
      filter = { test: (value) => Boolean(match) && (exact ? normalize(value) === match : normalize(value).includes(match)), error: '' }
    }
  } catch (error) {
    filter = { test: () => false, error: `Invalid regex: ${error.message}` }
  }
  if (!filter.error) {
    const test = filter.test
    const results = new Map()
    filter.test = (value) => {
      const cached = results.get(value)
      if (cached !== undefined) return cached
      const result = test(value)
      if (results.size >= 4096) results.delete(results.keys().next().value)
      results.set(value, result)
      return result
    }
  }
  if (filterCache.size >= 128) filterCache.delete(filterCache.keys().next().value)
  filterCache.set(key, filter)
  return filter
}

export function matchesRule(transaction, rule) {
  if (rule.direction === 'out' && transaction.amount >= 0) return false
  if (rule.direction === 'in' && transaction.amount <= 0) return false
  let prepared = ruleFilterCache.get(rule)
  if (!prepared || prepared.field !== rule.field || prepared.value !== rule.value || prepared.matchType !== rule.matchType) {
    prepared = { field: rule.field, value: rule.value, matchType: rule.matchType, filter: compileFilter(rule.value, rule.matchType, rule.field === 'counterAccount') }
    ruleFilterCache.set(rule, prepared)
  }
  return prepared.filter.test(transaction[rule.field] || '')
}

export function transactionCategory(transaction, categorization) {
  if (Object.hasOwn(categorization.assignments, transaction.id)) return categorization.assignments[transaction.id]
  return categorization.rules.find((rule) => matchesRule(transaction, rule))?.categoryId || ''
}

export function categorySummary(transactions, categorization) {
  const groups = new Map([...categorization.categories, { id: '', name: 'Uncategorized', color: '#9aa69e' }].map((category) => [category.id, { ...category, outgoing: 0, incoming: 0, count: 0 }]))
  for (const transaction of transactions) {
    const group = groups.get(transactionCategory(transaction, categorization)) || groups.get('')
    group.count++
    group.outgoing += Math.max(0, -transaction.amount)
    group.incoming += Math.max(0, transaction.amount)
  }
  return [...groups.values()].sort((left, right) => right.outgoing - left.outgoing)
}

export function monthlyCategorySpending(transactions, categorization) {
  return categorySpendingByInterval(transactions, categorization).map(({ period, ...bucket }) => ({ month: period, ...bucket }))
}

export function categorySpendingByInterval(transactions, categorization, interval = 'month', start, end) {
  const categoryIds = [...categorization.categories.map((category) => category.id), '']
  const buckets = new Map(cashflowByInterval(transactions, interval, start, end).map((bucket) => [bucket.period, { period: bucket.period, total: 0, categories: Object.fromEntries(categoryIds.map((id) => [id, 0])) }]))
  for (const transaction of transactions) {
    if (transaction.amount >= 0 || (start && transaction.date < start) || (end && transaction.date > end)) continue
    const resolvedId = transactionCategory(transaction, categorization)
    const categoryId = categoryIds.includes(resolvedId) ? resolvedId : ''
    const bucket = buckets.get(chartBucketKey(transaction.date, interval))
    bucket.categories[categoryId] += -transaction.amount
    bucket.total += -transaction.amount
  }
  return [...buckets.values()]
}

export function merchantIdentity(transaction) {
  const name = (transaction.counterparty || '').normalize('NFKC').trim().replace(/^(?:BCK|CCV|PAY\.nl|SumUp)\s*\*\s*/i, '')
  if (/^(?:AH|Albert\s+Heijn)\b/i.test(name)) return { id: 'merchant:albert-heijn', name: 'Albert Heijn (AH)' }
  if (/^ALDI\b/i.test(name)) return { id: 'merchant:aldi', name: 'ALDI' }
  if (name) return { id: `name:${normalize(name).replace(/\s+/g, ' ')}`, name }
  if (transaction.counterAccount) return { id: `account:${normalize(transaction.counterAccount)}`, name: transaction.counterAccount }
  return { id: 'unknown', name: 'Unknown counterparty' }
}

export function merchantSummary(transactions, categorization, categoryId) {
  const groups = new Map()
  for (const transaction of transactions) {
    if (transactionCategory(transaction, categorization) !== categoryId) continue
    const merchant = merchantIdentity(transaction)
    if (!groups.has(merchant.id)) groups.set(merchant.id, { ...merchant, outgoing: 0, incoming: 0, count: 0 })
    const group = groups.get(merchant.id)
    group.count++
    group.outgoing += Math.max(0, -transaction.amount)
    group.incoming += Math.max(0, transaction.amount)
  }
  return [...groups.values()].sort((left, right) => right.outgoing - left.outgoing || left.name.localeCompare(right.name))
}

export function validateCategorization(state) {
  if (!state || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.categories) || !Array.isArray(state.rules) || !state.assignments || typeof state.assignments !== 'object' || Array.isArray(state.assignments)) throw new Error('Invalid category data')
  const ids = new Set()
  const names = new Set(['uncategorized'])
  for (const category of state.categories) {
    if (typeof category.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(category.id) || ids.has(category.id) || typeof category.name !== 'string' || !category.name.trim() || category.name.length > 60 || names.has(normalize(category.name)) || !/^#[a-fA-F0-9]{6}$/.test(category.color)) throw new Error('Category names must be unique (1-60 characters) and have a valid color')
    ids.add(category.id)
    names.add(normalize(category.name))
  }
  const ruleIds = new Set()
  for (const rule of state.rules) {
    if (typeof rule.id !== 'string' || !rule.id || ruleIds.has(rule.id) || !ids.has(rule.categoryId) || !['counterparty', 'description', 'counterAccount'].includes(rule.field) || !['all', 'out', 'in'].includes(rule.direction) || typeof rule.value !== 'string' || !rule.value.trim() || rule.value.length > 200) throw new Error('Invalid categorization rule')
    if (rule.matchType !== undefined && !['text', 'regex'].includes(rule.matchType)) throw new Error('Invalid rule match type')
    const filter = compileFilter(rule.value, rule.matchType, rule.field === 'counterAccount')
    if (filter.error) throw new Error(filter.error)
    ruleIds.add(rule.id)
  }
  for (const categoryId of Object.values(state.assignments)) {
    if (categoryId !== '' && !ids.has(categoryId)) throw new Error('Unknown category assignment')
  }
  return state
}

export function updateCategorization(state, command, transactions, createId) {
  if (command.revision !== state.revision) throw Object.assign(new Error('Categories changed in another window. Rescan and try again.'), { status: 409 })
  const next = structuredClone(state)
  if (command.action === 'saveCategory') {
    const category = { id: command.category?.id || createId(), name: command.category?.name?.trim(), color: command.category?.color }
    if (command.category?.id && !next.categories.some((item) => item.id === category.id)) throw new Error('Unknown category')
    const index = next.categories.findIndex((item) => item.id === category.id)
    if (index < 0) next.categories.push(category)
    else next.categories[index] = category
  } else if (command.action === 'deleteCategory') {
    if (!next.categories.some((category) => category.id === command.id)) throw new Error('Unknown category')
    next.categories = next.categories.filter((category) => category.id !== command.id)
    next.rules = next.rules.filter((rule) => rule.categoryId !== command.id)
    for (const [id, categoryId] of Object.entries(next.assignments)) {
      if (categoryId === command.id) next.assignments[id] = ''
    }
  } else if (command.action === 'assign') {
    if (!Array.isArray(command.transactionIds) || !command.transactionIds.length || command.transactionIds.length > 10000) throw new Error('Choose between 1 and 10,000 transactions')
    const ids = new Set(transactions.map((transaction) => transaction.id))
    for (const id of command.transactionIds) {
      if (!ids.has(id)) throw new Error('Transaction not found; rescan and try again')
      if (command.categoryId === null) delete next.assignments[id]
      else next.assignments[id] = command.categoryId
    }
  } else if (command.action === 'saveRule') {
    const rule = { id: command.rule?.id || createId(), categoryId: command.rule?.categoryId, field: command.rule?.field, matchType: command.rule?.matchType ?? 'text', value: command.rule?.matchType === 'regex' ? command.rule?.value : command.rule?.value?.trim(), direction: command.rule?.direction }
    if (command.rule?.id && !next.rules.some((item) => item.id === rule.id)) throw new Error('Unknown rule')
    next.rules = [rule, ...next.rules.filter((item) => item.id !== rule.id)]
  } else if (command.action === 'deleteRule') {
    if (!next.rules.some((rule) => rule.id === command.id)) throw new Error('Unknown rule')
    next.rules = next.rules.filter((rule) => rule.id !== command.id)
  } else throw new Error('Unknown category action')
  next.revision++
  return validateCategorization(next)
}