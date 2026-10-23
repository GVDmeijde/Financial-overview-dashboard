import { useTranslation } from 'react-i18next'
import { createI18n, localeFor, persistLanguage, savedLanguage } from './i18n.js'
import dutch from './locales/nl.json' with { type: 'json' }

let storage
try { if (typeof document !== 'undefined') storage = globalThis.localStorage } catch {}
export const i18n = await createI18n(savedLanguage(storage, globalThis.navigator?.language), dutch)

function updateLanguage(language) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language
    document.title = i18n.t('Financial Overview')
  }
  persistLanguage(language, storage)
}

i18n.on('languageChanged', updateLanguage)
updateLanguage(i18n.language)

export function useLocale() {
  const { t, i18n: instance } = useTranslation()
  return { t, locale: localeFor(instance.language), language: instance.language }
}

export function localizeError(message, t) {
  if (!message) return ''
  if (Array.isArray(message)) return message.map((failure) => `${failure.file}: ${localizeError(failure.message, t)}`).join('; ')
  if (message.startsWith('Invalid regex: ')) return t('Invalid regex: {{detail}}', { detail: message.slice(15) })
  const quotes = message.match(/^(\d+) unescaped quote\(s\) recovered in CSV fields$/)
  if (quotes) return t('Recovered quotes in CSV fields: {{count}}', { count: Number(quotes[1]) })
  const row = message.match(/^Row (\d+): (.*)$/s)
  if (row) return t('Row {{row}}: {{detail}}', { row: row[1], detail: localizeError(row[2], t) })
  const columns = message.match(/^Missing columns: (.*)$/s)
  if (columns) return t('Missing columns: {{columns}}', { columns: columns[1] })
  const csv = message.match(/^CSV error: (.*)$/s)
  if (csv) return t('CSV error: {{detail}}', { detail: csv[1] })
  return Object.hasOwn(dutch, message) ? t(message) : t('Technical details: {{detail}}', { detail: message })
}