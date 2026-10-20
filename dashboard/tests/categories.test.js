import test from 'node:test'
import assert from 'node:assert/strict'
import { categorySummary, compileFilter, emptyCategorization, matchesRule, merchantIdentity, merchantSummary, transactionCategory, updateCategorization, validateCategorization } from '../src/categories.js'

const transaction = { id: 'NL01:EUR:1', counterparty: 'ALBERT HEIJN', description: 'Weekly groceries', counterAccount: 'NL02', amount: -1234 }
const rule = { categoryId: 'groceries', field: 'counterparty', value: 'Albert Heijn', direction: 'out' }
let nextId = 0
const update = (state, command) => updateCategorization(state, { revision: state.revision, ...command }, [transaction], () => `new-id-${++nextId}`)

test('rules match case-insensitive text, exact counter accounts, and direction', () => {
  assert.equal(matchesRule(transaction, rule), true)
  assert.equal(matchesRule({ ...transaction, amount: 100 }, rule), false)
  assert.equal(matchesRule(transaction, { ...rule, field: 'counterAccount', value: 'NL0' }), false)
  assert.equal(matchesRule(transaction, { ...rule, field: 'counterAccount', value: ' nl02 ' }), true)
  assert.equal(matchesRule(transaction, { ...rule, value: ' ' }), false)
})

test('manual categories and explicit uncategorized override rules; reset restores rules', () => {
  let state = update(emptyCategorization(), { action: 'saveRule', rule })
  assert.equal(transactionCategory(transaction, state), 'groceries')
  state = update(state, { action: 'assign', transactionIds: [transaction.id], categoryId: 'insurance' })
  assert.equal(transactionCategory(transaction, state), 'insurance')
  state = update(state, { action: 'assign', transactionIds: [transaction.id], categoryId: '' })
  assert.equal(transactionCategory(transaction, state), '')
  state = update(state, { action: 'assign', transactionIds: [transaction.id], categoryId: null })
  assert.equal(transactionCategory(transaction, state), 'groceries')
})

test('most recently saved rule wins, including future matching transactions', () => {
  let state = update(emptyCategorization(), { action: 'saveRule', rule })
  state = update(state, { action: 'saveRule', rule: { ...rule, id: undefined, categoryId: 'subscriptions' } })
  assert.equal(transactionCategory({ ...transaction, id: 'new-import' }, state), 'subscriptions')
})

test('category CRUD validates names and cleans assignments and rules on delete', () => {
  let state = update(emptyCategorization(), { action: 'saveCategory', category: { name: 'Transport', color: '#123456' } })
  assert.equal(state.categories.at(-1).name, 'Transport')
  assert.throws(() => update(state, { action: 'saveCategory', category: { name: ' groceries ', color: '#123456' } }), /unique/)
  state = update(state, { action: 'saveRule', rule })
  state = update(state, { action: 'assign', transactionIds: [transaction.id], categoryId: 'groceries' })
  state = update(state, { action: 'deleteCategory', id: 'groceries' })
  assert.equal(state.rules.length, 0)
  assert.equal(transactionCategory(transaction, state), '')
})

test('rejects stale revisions, unknown transactions, invalid rules, and categories', () => {
  const state = emptyCategorization()
  assert.throws(() => updateCategorization(state, { revision: 5 }, [], () => 'id'), /another window/)
  assert.throws(() => update(state, { action: 'assign', transactionIds: ['missing'], categoryId: '' }), /not found/)
  assert.throws(() => update(state, { action: 'assign', transactionIds: [transaction.id], categoryId: 'missing' }), /Unknown category/)
  assert.throws(() => update(state, { action: 'saveRule', rule: { ...rule, field: 'source' } }), /Invalid/)
})

test('summaries use cents, separate credits from debits, and include uncategorized', () => {
  const state = { ...emptyCategorization(), rules: [rule] }
  const summary = categorySummary([transaction, { ...transaction, id: '2', amount: 500 }, { ...transaction, id: '3', counterparty: 'Other', amount: -66 }], state)
  assert.equal(summary.find((group) => group.id === 'groceries').outgoing, 1234)
  assert.equal(summary.find((group) => group.id === '').outgoing, 66)
  assert.equal(summary.find((group) => group.id === '').incoming, 500)
  assert.equal(summary.reduce((sum, group) => sum + group.count, 0), 3)
})

test('regex rules match AH branches without matching unrelated names', () => {
  const regexRule = { ...rule, matchType: 'regex', value: '^AH (Bemmel|Opheusden)$' }
  assert.equal(matchesRule({ ...transaction, counterparty: 'AH Bemmel' }, regexRule), true)
  assert.equal(matchesRule({ ...transaction, counterparty: 'ah opheusden' }, regexRule), true)
  assert.equal(matchesRule({ ...transaction, counterparty: 'SHAH STORE' }, regexRule), false)
  assert.equal(matchesRule({ ...transaction, counterparty: 'AH Bemmel', amount: 50 }, regexRule), false)
})

test('regex matching preserves escapes, case-sensitive operators, whitespace, and repeatability', () => {
  const filter = compileFilter('^AH\\s+\\D+$', 'regex')
  assert.equal(filter.test('AH Bemmel'), true)
  assert.equal(filter.test('AH Bemmel'), true)
  assert.equal(filter.test('AH 123'), false)
  assert.equal(compileFilter('^AH ', 'regex').test('AH Bemmel'), true)
  assert.equal(compileFilter('^AH ', 'regex').test('AHBEMMEL'), false)
  assert.equal(compileFilter('\\bAH\\b', 'regex').test('SHAH'), false)
  assert.equal(compileFilter('bol.com', 'text').test('bolXcom'), false)
  assert.equal(compileFilter('\\(', 'regex').test('Reference (123)'), true)
})

test('invalid and unsupported regexes fail closed without crashing the matcher', () => {
  for (const pattern of ['(', '(?=AH)', '(AH)\\1', 'a'.repeat(201)]) {
    const filter = compileFilter(pattern, 'regex')
    assert.ok(filter.error)
    assert.equal(filter.test('AH Bemmel'), false)
  }
  assert.equal(compileFilter('^(a+)+$', 'regex').test(`${'a'.repeat(10000)}!`), false)
})

test('regex settings persist without trimming patterns; legacy rules remain plain text', () => {
  let state = update(emptyCategorization(), { action: 'saveRule', rule: { ...rule, matchType: 'regex', value: '^AH ' } })
  assert.equal(state.rules[0].matchType, 'regex')
  assert.equal(state.rules[0].value, '^AH ')
  assert.equal(validateCategorization(JSON.parse(JSON.stringify(state))).rules[0].value, '^AH ')
  state = update(state, { action: 'saveRule', rule: { ...rule, value: 'ALBERT.*' } })
  assert.equal(state.rules[0].matchType, 'text')
  assert.equal(matchesRule(transaction, state.rules[0]), false)
  const legacy = { ...emptyCategorization(), rules: [{ ...rule, id: 'legacy' }] }
  assert.equal(validateCategorization(legacy), legacy)
  assert.equal(transactionCategory(transaction, legacy), 'groceries')
  assert.throws(() => update(state, { action: 'saveRule', rule: { ...rule, matchType: 'regex', value: '(' } }), /Invalid regex/)
  assert.throws(() => update(state, { action: 'saveRule', rule: { ...rule, matchType: 'unknown' } }), /Invalid rule match type/)
})

test('merchant identities combine AH and ALDI locations without combining unrelated merchants', () => {
  for (const name of ['AH Bemmel', 'AH Opheusden', 'Albert Heijn Bemmel BEMMEL', 'BCK*AH Hart vd Waalsprong']) {
    assert.equal(merchantIdentity({ counterparty: name }).id, 'merchant:albert-heijn')
  }
  for (const name of ['ALDI CUL016 HAALDEREN', 'Aldi 16 Haalderen', 'ALDI SUED Kranenburg DEU']) {
    assert.equal(merchantIdentity({ counterparty: name }).id, 'merchant:aldi')
  }
  assert.notEqual(merchantIdentity({ counterparty: 'SHAH STORE' }).id, 'merchant:albert-heijn')
  assert.notEqual(merchantIdentity({ counterparty: 'AHOLD' }).id, 'merchant:albert-heijn')
  assert.notEqual(merchantIdentity({ counterparty: 'ALDINE' }).id, 'merchant:aldi')
  assert.equal(merchantIdentity({ counterparty: 'CCV*Local Shop' }).id, merchantIdentity({ counterparty: 'local   shop' }).id)
  assert.notEqual(merchantIdentity({ counterparty: 'Local Shop North' }).id, merchantIdentity({ counterparty: 'Local Shop South' }).id)
})

test('merchant breakdown reconciles category spending and keeps credits separate', () => {
  const transactions = [
    { ...transaction, id: '1', counterparty: 'AH Bemmel', amount: -1000 },
    { ...transaction, id: '2', counterparty: 'Albert Heijn Opheusden', amount: -500 },
    { ...transaction, id: '3', counterparty: 'ALDI CUL016 HAALDEREN', amount: -250 },
    { ...transaction, id: '4', counterparty: 'AH Bemmel', amount: 200 },
    { ...transaction, id: '5', counterparty: 'Other', amount: -900 },
  ]
  const state = { ...emptyCategorization(), assignments: { 1: 'groceries', 2: 'groceries', 3: 'groceries', 4: 'groceries', 5: 'insurance' } }
  const merchants = merchantSummary(transactions, state, 'groceries')
  assert.equal(merchants.length, 2)
  assert.deepEqual(merchants[0], { id: 'merchant:albert-heijn', name: 'Albert Heijn (AH)', outgoing: 1500, incoming: 200, count: 3 })
  const category = categorySummary(transactions, state).find((group) => group.id === 'groceries')
  assert.equal(merchants.reduce((sum, merchant) => sum + merchant.outgoing, 0), category.outgoing)
  assert.equal(merchants.reduce((sum, merchant) => sum + merchant.incoming, 0), category.incoming)
  assert.equal(merchants.reduce((sum, merchant) => sum + merchant.count, 0), category.count)
  assert.deepEqual(merchantSummary([], state, 'groceries'), [])
})

test('unnamed and credit-only merchants stay visible without inventing spending', () => {
  const transactions = [
    { ...transaction, id: '1', counterparty: '', counterAccount: 'NL03', amount: 100 },
    { ...transaction, id: '2', counterparty: '', counterAccount: '', amount: 0 },
  ]
  const groups = merchantSummary(transactions, emptyCategorization(), '')
  assert.equal(groups.length, 2)
  assert.equal(groups.find((group) => group.id === 'account:nl03').incoming, 100)
  assert.equal(groups.reduce((sum, group) => sum + group.outgoing, 0), 0)
  assert.ok(groups.some((group) => group.id === 'unknown'))
})