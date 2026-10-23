import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import dutch from '../src/locales/nl.json' with { type: 'json' }
import { formatChartPeriod } from '../src/finance.js'
import { localizeError } from '../src/localization.js'
import { createI18n, formatNumber, languageStorageKey, localeFor, persistLanguage, resolveLanguage, savedLanguage } from '../src/i18n.js'

test('language preference uses saved choice, then browser language, then English', () => {
  assert.equal(savedLanguage({ getItem: () => 'en' }, 'nl-NL'), 'en')
  assert.equal(savedLanguage({ getItem: () => null }, 'nl-NL'), 'nl')
  assert.equal(savedLanguage({ getItem: () => { throw new Error('Blocked') } }, 'fr'), 'en')
  assert.equal(resolveLanguage('NL-nl'), 'nl')
  let saved
  persistLanguage('nl', { setItem: (key, value) => { saved = [key, value] } })
  assert.deepEqual(saved, [languageStorageKey, 'nl'])
  assert.doesNotThrow(() => persistLanguage('nl', { setItem: () => { throw new Error('Blocked') } }))
})

test('translations switch languages, interpolate data, pluralize, and fall back to English', async () => {
  const i18n = await createI18n('en', { Overview: 'Overzicht', '{{count}} transactions_one': '{{count}} transactie', '{{count}} transactions_other': '{{count}} transacties' })
  assert.equal(i18n.t('Overview'), 'Overview')
  assert.equal(i18n.t('{{count}} transactions', { count: 1 }), '1 transaction')
  await i18n.changeLanguage('nl')
  assert.equal(i18n.t('Overview'), 'Overzicht')
  assert.equal(i18n.t('{{count}} transactions', { count: 2 }), '2 transacties')
  assert.equal(i18n.t('Account {{number}}', { number: '6637' }), 'Account 6637')
  assert.equal(i18n.t('Missing translation'), 'Missing translation')
})

test('locale formatting changes separators without changing amounts or currencies', () => {
  assert.equal(localeFor('nl'), 'nl-NL')
  assert.equal(formatNumber(1234.56, 'nl'), '1.234,56')
  assert.equal(formatNumber(1234.56, 'en'), '1,234.56')
  assert.match(formatNumber(1234.56, 'nl', { style: 'currency', currency: 'EUR' }), /1\.234,56/)
  assert.match(formatNumber(1234.56, 'en', { style: 'currency', currency: 'USD' }), /1,234\.56/)
})

test('the Dutch catalogue keeps all interpolation values and plural pairs', async () => {
  const i18n = await createI18n('nl', dutch)
  const placeholders = (text) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]).sort()
  for (const [key, value] of Object.entries(dutch)) {
    assert.ok(value.trim(), key)
    assert.deepEqual(placeholders(value), placeholders(key), key)
    if (key.endsWith('_one')) assert.ok(dutch[key.replace(/_one$/, '_other')], key)
  }
  assert.equal(i18n.t('Assign {{count}} transactions', { count: 1 }), '1 transactie toewijzen')
  assert.equal(i18n.t('{{count}} transactions', { count: 1234 }), '1.234 transacties')
  await i18n.changeLanguage('en')
  assert.equal(i18n.t('{{count}} bank accounts', { count: 1 }), '1 bank account')
  assert.equal(i18n.t('{{count}} bank accounts', { count: 2 }), '2 bank accounts')
})

test('interface text and static translation keys have Dutch coverage', () => {
  for (const filename of ['App.jsx', 'Categories.jsx']) {
    const tree = parse(readFileSync(new URL(`../src/${filename}`, import.meta.url), 'utf8'), { sourceType: 'module', plugins: ['jsx'] })
    function visit(node) {
      if (!node || typeof node !== 'object') return
      if (node.type === 'JSXText' && /[a-z]/i.test(node.value)) assert.ok(['K', 'English', 'Nederlands'].includes(node.value.trim()), `${filename}: untranslated text ${node.value.trim()}`)
      if (node.type === 'JSXAttribute' && ['title', 'aria-label', 'placeholder'].includes(node.name.name)) assert.notEqual(node.value?.type, 'StringLiteral', `${filename}: untranslated ${node.name.name}`)
      if (node.type === 'CallExpression' && node.callee.name === 't' && node.arguments[0]?.type === 'StringLiteral') {
        const key = node.arguments[0].value
        assert.ok(Object.hasOwn(dutch, key) || Object.hasOwn(dutch, `${key}_other`), `${filename}: missing ${key}`)
      }
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'extra'].includes(key)) continue
        if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === 'object') visit(value)
      }
    }
    visit(tree)
  }
})

test('chart date formatters do not retain the previous language', () => {
  assert.equal(formatChartPeriod('2026-10', 'month', true, 'en-GB'), 'October 2026')
  assert.equal(formatChartPeriod('2026-10', 'month', true, 'nl-NL'), 'oktober 2026')
  assert.match(formatChartPeriod('2026-10-19', 'week', true, 'nl-NL'), /^Week van .*oktober/)
  assert.match(formatChartPeriod('2026-10-19', 'week', true, 'en-GB'), /^Week of .*October/)
})

test('error wrappers translate while preserving file names, columns, and technical details', async () => {
  const i18n = await createI18n('nl', dutch)
  const t = i18n.t.bind(i18n)
  assert.equal(localizeError('Row 4: Invalid transaction date', t), 'Rij 4: Ongeldige transactiedatum')
  assert.equal(localizeError('Missing columns: IBAN/BBAN', t), 'Ontbrekende kolommen: IBAN/BBAN')
  assert.equal(localizeError('2 unescaped quote(s) recovered in CSV fields', t), 'Herstelde aanhalingstekens in CSV-velden: 2')
  assert.equal(localizeError([{ file: 'bank.csv', message: 'File exceeds the 20 MB limit' }], t), 'bank.csv: Bestand overschrijdt de limiet van 20 MB')
  assert.equal(localizeError('Invalid regex: Unsupported lookahead', t), 'Ongeldige regex: Unsupported lookahead')
})