import i18next from 'i18next'

export const languageStorageKey = 'financial-overview.language'
export const supportedLanguages = ['en', 'nl']

export function resolveLanguage(language) {
  const base = String(language || '').toLowerCase().split('-')[0]
  return supportedLanguages.includes(base) ? base : 'en'
}

export function savedLanguage(storage, browserLanguage) {
  try {
    const saved = storage?.getItem(languageStorageKey)
    if (saved) return resolveLanguage(saved)
  } catch {}
  return resolveLanguage(browserLanguage)
}

export async function createI18n(language = 'en', translations = {}) {
  const instance = i18next.createInstance()
  const singulars = {
    '{{count}} transactions': '{{count}} transaction',
    '{{count}} bank accounts': '{{count}} bank account',
    '{{count}} source files in your import folder': '{{count}} source file in your import folder',
    '{{count}} source files with import notices': '{{count}} source file with import notices',
    '{{count}} internal transfer entries excluded': '{{count}} internal transfer entry excluded',
    '{{count}} transactions / External activity': '{{count}} transaction / External activity',
    '{{count}} selected accounts / Recorded daily closing balances': '{{count}} selected account / Recorded daily closing balances',
    'Assign {{count}} transactions': 'Assign {{count}} transaction',
    '{{count}} groups': '{{count}} group',
    '{{count}} matches / All imported transactions': '{{count}} match / All imported transactions',
    '{{count}} rules': '{{count}} rule',
    '{{count}} transactions imported': '{{count}} transaction imported',
  }
  const english = Object.fromEntries(Object.entries(singulars).flatMap(([key, singular]) => [[`${key}_one`, singular], [`${key}_other`, key]]))
  const formatCounts = (resources) => Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, value.replaceAll('{{count}}', '{{count, number}}')]))
  await instance.init({
    lng: resolveLanguage(language),
    fallbackLng: 'en',
    supportedLngs: supportedLanguages,
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: formatCounts(english) },
      nl: { translation: formatCounts(translations) },
    },
  })
  return instance
}

export function localeFor(language) {
  return resolveLanguage(language) === 'nl' ? 'nl-NL' : 'en-GB'
}

export function formatNumber(value, language, options) {
  return new Intl.NumberFormat(localeFor(language), options).format(value)
}

export function persistLanguage(language, storage) {
  try { storage?.setItem(languageStorageKey, resolveLanguage(language)) } catch {}
}