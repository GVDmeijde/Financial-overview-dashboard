import { i18n, localizeError, useLocale } from './localization.js'
import { useDeferredValue, useEffect, useRef, useState, useTransition } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownLeft, ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpRight, ChartNoAxesCombined, Check, ChevronLeft, ChevronRight, CircleAlert, Eye, EyeOff, FileCheck2, FolderInput, Landmark, LayoutDashboard, ListFilter, LoaderCircle, RefreshCw, Regex, Search, ShieldCheck, Tags, Upload, Wallet, X } from 'lucide-react'
import Papa from 'papaparse'
import englishFlag from './assets/flags/gb.svg'
import dutchFlag from './assets/flags/nl.svg'
import { balanceTimeline, cashflowByInterval, chartInterval, compareTransactions, formatChartPeriod, getAccounts, monthlyAverageMonths, summarizePeriod } from './finance.js'
import { categorySummary, compileFilter, emptyCategorization, transactionCategory } from './categories.js'
import { Categories, CategoryBreakdown, CategoryDetail, CategorySelect, CategorySpendingChart } from './Categories.jsx'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/600.css'
import '@fontsource/manrope/700.css'
import './App.css'

const colors = ['#087f70', '#4285d4', '#bd7b12', '#bb5274', '#6f72ba', '#647762']
const dateFormatters = new Map()
function shortDate(date, locale) {
  if (!dateFormatters.has(locale)) dateFormatters.set(locale, new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }))
  return dateFormatters.get(locale).format(new Date(typeof date === 'number' ? date : `${date}T12:00:00Z`))
}
const accountName = (account, t) => t('Account {{number}}', { number: account.iban.slice(-4) })

function LanguageSelector() {
  const { t, language } = useLocale()
  return <select className="language-selector" style={{ backgroundImage: `url("${language === 'nl' ? dutchFlag : englishFlag}")` }} aria-label={t('Language')} title={t('Language')} value={language} onChange={(event) => i18n.changeLanguage(event.target.value)}>
    <option value="en" lang="en">English</option><option value="nl" lang="nl">Nederlands</option>
  </select>
}

async function fetchData(signal) {
  const response = await fetch('/api/data', { signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to load transactions')
  return data
}

function IconButton({ title, children, ...props }) {
  return <button className="icon-button" type="button" title={title} aria-label={title} {...props}>{children}</button>
}

function AccountSelection({ accounts, money, initialSelection, onChange }) {
  const { t, locale } = useLocale()
  const [selection, setSelection] = useState(initialSelection)
  const latestSelection = useRef(initialSelection)
  const [pending, startTransition] = useTransition()
  const selectedIds = accounts.filter((account) => selection === null || selection.includes(account.id)).map((account) => account.id)

  function update(next) {
    latestSelection.current = next
    setSelection(next)
    startTransition(() => onChange(next))
  }

  function toggle(id) {
    const next = new Set(accounts.filter((account) => latestSelection.current === null || latestSelection.current.includes(account.id)).map((account) => account.id))
    if (next.has(id)) next.delete(id)
    else next.add(id)
    update([...next])
  }

  return <>
    <div className="accounts-label"><span className="nav-label">{t("BANK ACCOUNTS")}</span><span className="account-update-status" role="status">{pending && <><LoaderCircle size={12} className="spin" /><span className="sr-only">{t("Updating account reports")}</span></>}</span><button className="text-button" onClick={() => update(null)}>{t("Select all")}</button></div>
    <div className="account-list" aria-busy={pending}>{accounts.map((account, index) => <label className={`account-option ${selectedIds.includes(account.id) ? 'selected' : ''}`} key={account.id}>
      <input type="checkbox" checked={selectedIds.includes(account.id)} onChange={() => toggle(account.id)} aria-label={t('Include {{account}}', { account: accountName(account, t) })} />
      <span className="account-top"><span className="bank-icon" style={{ color: colors[index % colors.length], background: `${colors[index % colors.length]}12` }}><Landmark size={17} /></span><span><strong>{accountName(account, t)}</strong><small>{account.iban.replace(/(.{4})/g, '$1 ').trim()}</small></span><span className="account-check" style={{ '--account-color': colors[index % colors.length] }}>{selectedIds.includes(account.id) && <Check size={12} />}</span></span>
      <span className="account-balance">{money(account.balance, account.currency)}<small>{shortDate(account.lastDate, locale)}</small></span>
    </label>)}</div>
  </>
}

function TransactionPageInput({ currentPage, pageCount, onChange, disabled }) {
  const { t } = useLocale()
  const [value, setValue] = useState(String(currentPage + 1))
  function commit() {
    const number = Number(value)
    const next = value.trim() && Number.isInteger(number) ? Math.min(pageCount, Math.max(1, number)) : currentPage + 1
    setValue(String(next))
    onChange(next - 1)
  }
  return <label className="page-jump">{t("Page")}<input type="number" inputMode="numeric" aria-label={t("Transaction page")} min={1} max={pageCount} step={1} value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} /><span>{t('of {{count}}', { count: pageCount })}</span></label>
}

function TransactionDialog({ transaction, money, onClose, categorization, saving, onChange, onCreateRule, internalTransfer }) {
  const { t, locale } = useLocale()
  const ref = useRef(null)
  useEffect(() => { ref.current.showModal() }, [])
  return <dialog ref={ref} onClose={onClose} className="transaction-dialog" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="section-heading"><h2>{t("Transaction details")}</h2><IconButton title={t("Close details")} onClick={onClose}><X size={19} /></IconButton></div>
    <div className={`detail-amount ${transaction.amount >= 0 ? 'positive' : ''}`}>{money(transaction.amount, transaction.currency)}</div>
    <h3>{transaction.counterparty || t("Bank transaction")}</h3>
    {internalTransfer ? <div className="dialog-category"><span className="transfer-badge"><ArrowLeftRight size={14} />{t("Internal transfer")}</span><p className="section-subtitle">{t("Excluded from spending and cash flow")}</p></div> : <div className="dialog-category"><label>{t("Category")}<CategorySelect categorization={categorization} includeRules value={transactionCategory(transaction, categorization)} disabled={saving} onChange={(event) => onChange({ action: 'assign', transactionIds: [transaction.id], categoryId: event.target.value === '__rules__' ? null : event.target.value })} /></label><div><span className="muted">{saving ? t("Saving...") : Object.hasOwn(categorization.assignments, transaction.id) ? t("Manual assignment") : t("Automatic / Rules")}</span><button className="text-button" disabled={saving || (!transaction.counterparty && !transaction.counterAccount && !transaction.description)} onClick={() => onCreateRule(transaction)}><Tags size={14} />{t("Create rule")}</button></div></div>}
    <dl>{[
      [t("Date"), shortDate(transaction.date, locale)], [t("Account"), transaction.account], [t("Counterparty account"), transaction.counterAccount || t("Not provided")],
      [t("Description"), transaction.description || t("Not provided")], [t("Balance after transaction"), money(transaction.balance, transaction.currency)],
      [t("Sequence"), transaction.sequence], [t("Source file"), transaction.source],
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </dialog>
}

function App() {
  const { t, locale } = useLocale()
  const number = (value, options) => new Intl.NumberFormat(locale, options).format(value)
  const compact = (value) => number(value / 100, { notation: 'compact', maximumFractionDigits: 1 })
  const formatMoney = (value, currency) => number(value / 100, { style: 'currency', currency })
  const balanceTickFormatter = new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' })
  const [data, setData] = useState({ transactions: [], files: [] })
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [view, setView] = useState('overview')
  const [currency, setCurrency] = useState('EUR')
  const [selection, setSelection] = useState(null)
  const [range, setRange] = useState({ start: '', end: '', preset: 'ALL' })
  const [mode, setMode] = useState('accounts')
  const [privateAmounts, setPrivateAmounts] = useState(false)
  const [query, setQuery] = useState('')
  const [regexSearch, setRegexSearch] = useState(false)
  const deferredQuery = useDeferredValue(query)
  const [direction, setDirection] = useState('all')
  const [transferFilter, setTransferFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [detailCategoryId, setDetailCategoryId] = useState('')
  const [bulkCategory, setBulkCategory] = useState('')
  const [savingCategories, setSavingCategories] = useState(false)
  const [ruleDraft, setRuleDraft] = useState({ field: 'counterparty', matchType: 'text', value: '', direction: 'out', categoryId: 'groceries' })
  const [page, setPage] = useState(0)
  const [detail, setDetail] = useState(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef(null)
  const categorization = data.categorization || emptyCategorization()
  const viewLabel = { overview: t("Overview"), transactions: t("Transactions"), categories: t("Categories"), category: t("Category details"), imports: t("Imports") }[view]

  async function loadData() {
    setBusy(true)
    setError('')
    try {
      setData(await fetchData())
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchData(controller.signal).then(setData).catch((failure) => {
      if (failure.name !== 'AbortError') setError(failure.message)
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false)
    })
    return () => controller.abort()
  }, [])

  const allAccounts = getAccounts(data.transactions)
  const currencies = [...new Set(allAccounts.map((account) => account.currency))]
  const activeCurrency = currencies.includes(currency) ? currency : currencies[0] || 'EUR'
  const accounts = allAccounts.filter((account) => account.currency === activeCurrency)
  const activeIds = accounts.filter((account) => selection === null || selection.includes(account.id)).map((account) => account.id)
  const relevant = data.transactions.filter((transaction) => transaction.currency === activeCurrency)
  const earliest = relevant[0]?.date || ''
  const latest = relevant.at(-1)?.date || ''
  const end = range.end || latest
  let start = range.start || earliest
  if (range.preset !== 'ALL' && range.preset !== 'CUSTOM' && latest) {
    const date = new Date(`${latest}T12:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() - Number(range.preset))
    start = date.toISOString().slice(0, 10)
  }
  const invalidRange = Boolean(start && end && start > end)
  const averageMonths = monthlyAverageMonths(start, end, range.preset)
  const timeline = balanceTimeline(data.transactions, activeIds, start, end)
  const chartData = timeline.map((point) => ({ ...point, timestamp: Date.parse(`${point.date}T00:00:00Z`), total: activeIds.length && activeIds.every((id) => point[id] !== undefined) ? activeIds.reduce((sum, id) => sum + point[id], 0) : null }))
  const closing = timeline.at(-1) || {}
  const totalBalance = activeIds.length && activeIds.every((id) => closing[id] !== undefined) ? activeIds.reduce((sum, id) => sum + closing[id], 0) : null
  const period = summarizePeriod(data.transactions, activeIds, start, end)
  const categoryGroups = categorySummary(period.reportingTransactions, categorization).map((category) => category.id ? category : { ...category, name: t('Uncategorized') })
  const selectedCategory = categoryGroups.find((category) => category.id === detailCategoryId)
  const money = (value, unit = activeCurrency) => privateAmounts ? '****' : value == null ? '--' : formatMoney(value, unit)
  const interval = chartInterval(start, end, range.preset)
  const intervalLabel = { day: t("Daily"), week: t("Weekly"), month: t("Monthly") }[interval]
  const cashflow = cashflowByInterval(period.reportingTransactions, interval, start, end)
  const sorted = [...period.transactions].sort((left, right) => compareTransactions(right, left))
  const reportingSorted = sorted.filter((transaction) => !period.internalTransferIds.has(transaction.id))
  const search = regexSearch ? deferredQuery : deferredQuery.trim()
  const searchFilter = compileFilter(search, regexSearch ? 'regex' : 'text')
  const filtered = sorted.filter((transaction) =>
    (direction === 'all' || (direction === 'in' ? transaction.amount > 0 : transaction.amount < 0)) &&
    (transferFilter === 'all' || (transferFilter === 'internal' ? period.internalTransferIds.has(transaction.id) : !period.internalTransferIds.has(transaction.id))) &&
    (categoryFilter === 'all' || transactionCategory(transaction, categorization) === categoryFilter) &&
    (!search || [transaction.counterparty, transaction.description, transaction.account, transaction.counterAccount, transaction.date, String(transaction.amount / 100)].some(searchFilter.test)),
  )
  const assignableTransactions = filtered.filter((transaction) => !period.internalTransferIds.has(transaction.id))
  const pageCount = Math.max(1, Math.ceil(filtered.length / 20))
  const currentPage = Math.min(page, pageCount - 1)
  const warnings = data.files.filter((file) => file.error || file.warnings?.length)

  async function changeCategories(command) {
    if (savingCategories) return false
    setSavingCategories(true)
    setError('')
    try {
      const response = await fetch('/api/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...command, revision: categorization.revision }) })
      const next = await response.json()
      if (!response.ok) throw new Error(next.error || 'Unable to save categories')
      setData((current) => ({ ...current, categorization: next }))
      if (command.action === 'deleteCategory' && categoryFilter === command.id) setCategoryFilter('all')
      if (command.action === 'deleteCategory' && bulkCategory === command.id) setBulkCategory('')
      if (command.action === 'deleteCategory') setRuleDraft((current) => current.categoryId === command.id ? { field: 'counterparty', matchType: 'text', value: '', direction: 'out', categoryId: next.categories[0]?.id || '' } : current)
      return true
    } catch (failure) {
      setError(failure.message)
      return false
    } finally {
      setSavingCategories(false)
    }
  }

  function viewCategory(id) {
    setDetailCategoryId(id)
    setView('category')
  }

  function viewCategoryTransactions(id) {
    setCategoryFilter(id)
    setQuery('')
    setDirection('all')
    setTransferFilter('external')
    setPage(0)
    setView('transactions')
  }

  function viewTransfers() {
    setTransferFilter('internal')
    setCategoryFilter('all')
    setQuery('')
    setDirection('all')
    setPage(0)
    setView('transactions')
  }

  function createRule(transaction) {
    const field = transaction.counterparty ? 'counterparty' : transaction.counterAccount ? 'counterAccount' : 'description'
    setRuleDraft({ field, matchType: 'text', value: transaction[field].slice(0, 200), direction: transaction.amount < 0 ? 'out' : transaction.amount > 0 ? 'in' : 'all', categoryId: transactionCategory(transaction, categorization) || categorization.categories[0]?.id || '' })
    setDetail(null)
    setView('categories')
  }

  async function importFiles(files) {
    if (!files.length || busy) return
    setBusy(true)
    setError('')
    setNotice('')
    let added = 0
    const failures = []
    for (const file of files) {
      try {
        if (!/\.csv$/i.test(file.name)) throw new Error('Only CSV files are supported')
        if (file.size > 20 * 1024 * 1024) throw new Error('File exceeds the 20 MB limit')
        const response = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) }, body: file })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Import failed')
        added += result.added
      } catch (failure) {
        failures.push({ file: file.name, message: failure.message })
      }
    }
    await loadData()
    setNotice(added ? { key: '{{count}} transactions imported', options: { count: added } } : failures.length ? '' : 'All transactions already imported')
    if (failures.length) setError(failures)
    setView('imports')
    if (fileInput.current) fileInput.current.value = ''
  }

  function exportTransactions() {
    const csv = Papa.unparse(filtered.map((transaction) => ({ Date: transaction.date, Account: transaction.account, Currency: transaction.currency, Counterparty: transaction.counterparty, Description: transaction.description, Category: period.internalTransferIds.has(transaction.id) ? 'Internal transfer' : categorization.categories.find((category) => category.id === transactionCategory(transaction, categorization))?.name || 'Uncategorized', 'Internal transfer': period.internalTransferIds.has(transaction.id), Amount: transaction.amount / 100, Balance: transaction.balance / 100 })), { escapeFormulae: true })
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `transactions-${start}-${end}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function transactionTable(rows, full = false) {
    return <div className="table-scroll"><table>
      <thead><tr><th>{t("Transaction")}</th><th>{t("Date")}</th>{full && <><th>{t("Account")}</th><th className="category-column">{t("Category")}</th></>}<th className="number">{t("Amount")}</th>{full && <th className="number">{t("Balance")}</th>}<th><span className="sr-only">{t("Details")}</span></th></tr></thead>
      <tbody>{rows.map((transaction) => <tr key={transaction.id}>
        <td><button className="transaction-name" onClick={() => setDetail(transaction)}><span className={`transaction-icon ${period.internalTransferIds.has(transaction.id) ? 'transfer' : transaction.amount >= 0 ? 'credit' : 'debit'}`}>{period.internalTransferIds.has(transaction.id) ? <ArrowLeftRight size={17} /> : transaction.amount >= 0 ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><span><strong>{transaction.counterparty || t("Bank transaction")}</strong><small>{period.internalTransferIds.has(transaction.id) ? `${t('Internal transfer')} / ` : ''}{transaction.description || transaction.counterAccount || t("No description")}</small></span></button></td>
        <td className="date-cell">{shortDate(transaction.date, locale)}</td>
        {full && <td className="account-cell"><i style={{ background: colors[accounts.findIndex((account) => account.id === transaction.accountId) % colors.length] }} />{transaction.account.slice(-4)}</td>}
        {full && <td className="category-column">{period.internalTransferIds.has(transaction.id) ? <span className="transfer-badge"><ArrowLeftRight size={12} />{t("Internal transfer")}</span> : <CategorySelect className="transaction-category" aria-label={t('Category for transaction {{id}}', { id: transaction.id })} categorization={categorization} includeRules value={transactionCategory(transaction, categorization)} disabled={savingCategories} onChange={(event) => changeCategories({ action: 'assign', transactionIds: [transaction.id], categoryId: event.target.value === '__rules__' ? null : event.target.value })} />}</td>}
        <td className={`number amount ${transaction.amount > 0 ? 'positive' : ''}`}>{transaction.amount > 0 && !privateAmounts ? '+' : ''}{money(transaction.amount)}</td>
        {full && <td className="number amount">{money(transaction.balance)}</td>}
        <td><IconButton title={t("View transaction details")} onClick={() => setDetail(transaction)}><ChevronRight size={16} /></IconButton></td>
      </tr>)}</tbody>
    </table>{!rows.length && <div className="empty-small">{t("No transactions match these filters.")}</div>}</div>
  }

  const chartTooltip = ({ active, payload, label }) => active && payload?.length ? <div className="chart-tooltip"><strong>{typeof label === 'number' ? shortDate(label, locale) : formatChartPeriod(String(label), interval, true, locale)}</strong>{payload.map((item) => <div key={item.dataKey}><span><i style={{ background: item.color }} />{item.name}</span><b>{money(item.value)}</b></div>)}</div> : null

  const chartAxes = <><CartesianGrid vertical={false} stroke="#e7ece9" strokeDasharray="3 4" /><XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value) => balanceTickFormatter.format(value)} minTickGap={65} axisLine={false} tickLine={false} tickMargin={12} /><YAxis tickFormatter={privateAmounts ? () => '****' : compact} axisLine={false} tickLine={false} width={60} /><Tooltip content={chartTooltip} /></>

  return <div className="app-shell">
    <input ref={fileInput} type="file" accept=".csv,text/csv" multiple className="sr-only" tabIndex={-1} onChange={(event) => importFiles([...event.target.files])} />
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setView('overview') }}><span className="brand-icon"><ChartNoAxesCombined size={22} strokeWidth={2.3} /></span><span>{t("Financial")}<span className="brand-second">{t("Overview")}</span></span></a>
      <div className="mobile-privacy"><LanguageSelector /><IconButton title={privateAmounts ? t("Show amounts") : t("Hide amounts")} onClick={() => setPrivateAmounts(!privateAmounts)}>{privateAmounts ? <EyeOff size={18} /> : <Eye size={18} />}</IconButton></div>
      <div className="workspace"><span className="workspace-avatar">K</span><span><strong>{t("Personal workspace")}</strong><small>{t("Local finances")}</small></span><ShieldCheck size={16} /></div>
      <div className="nav-label">{t("WORKSPACE")}</div>
      <nav aria-label={t("Main navigation")}>{[
        ['overview', LayoutDashboard, t("Overview")], ['transactions', ListFilter, t("Transactions")], ['categories', Tags, t("Categories")], ['imports', FolderInput, t("Imports")],
      ].map(([key, Icon, label]) => <button key={key} className={view === key || (view === 'category' && key === 'categories') ? 'nav-item active' : 'nav-item'} onClick={() => setView(key)}><Icon size={18} /><span>{label}</span>{key === 'imports' && <span className="nav-count">{data.files.length}</span>}</button>)}</nav>
      <AccountSelection key={activeCurrency} accounts={accounts} money={money} initialSelection={selection} onChange={(next) => { setSelection(next); setPage(0) }} />
      <div className="sidebar-bottom"><span className="local-dot" /><span>{t("Local workspace")}</span><ShieldCheck size={15} /></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">{t("Workspace")}<ChevronRight size={13} /><strong>{viewLabel}</strong></div><div className="topbar-actions"><span className="local-badge"><ShieldCheck size={14} />{t("Local only")}</span><IconButton title={privateAmounts ? t("Show amounts") : t("Hide amounts")} onClick={() => setPrivateAmounts(!privateAmounts)}>{privateAmounts ? <EyeOff size={18} /> : <Eye size={18} />}</IconButton><LanguageSelector /><span className="avatar">K</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">{t("YOUR MONEY, IN PERSPECTIVE")}</div><h1>{view === 'overview' ? t("Financial overview") : view === 'imports' ? t("Import history") : view === 'category' ? selectedCategory?.name || t("Category unavailable") : viewLabel}</h1><p>{view === 'imports' ? t('{{count}} source files in your import folder', { count: data.files.length }) : `${t('{{count}} bank accounts', { count: allAccounts.length })}${earliest ? ` / ${t('{{start}} to {{end}}', { start: shortDate(earliest, locale), end: shortDate(latest, locale) })}` : ''}`}</p></div><div className="heading-actions"><IconButton title={t("Rescan import folder")} disabled={busy || savingCategories} onClick={() => { setNotice(''); loadData() }}><RefreshCw size={17} className={busy ? 'spin' : ''} /></IconButton><button className="button primary" disabled={busy || savingCategories} onClick={() => fileInput.current.click()}><Upload size={16} />{t("Import CSV")}</button></div></div>
        {error && <div className="banner error" role="alert"><CircleAlert size={18} /><span>{localizeError(error, t)}</span><IconButton title={t("Dismiss error")} onClick={() => setError('')}><X size={16} /></IconButton></div>}
        {notice && <div className="banner success" role="status"><Check size={18} /><span>{typeof notice === 'object' ? t(notice.key, notice.options) : t(notice)}</span><IconButton title={t("Dismiss notification")} onClick={() => setNotice('')}><X size={16} /></IconButton></div>}
        {warnings.length > 0 && view !== 'imports' && <button className="warning-link" onClick={() => setView('imports')}><CircleAlert size={15} />{t('{{count}} source files with import notices', { count: warnings.length })}<ArrowRight size={14} /></button>}
        {view === 'imports' ? <>
          <section className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); importFiles([...event.dataTransfer.files]) }}>
            <div className="upload-symbol"><FolderInput size={30} /></div><h2>{t("Import bank statements")}</h2><p>{t("Rabobank CSV exports / Up to 20 MB per file")}</p><button className="button" disabled={busy} onClick={() => fileInput.current.click()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}{t("Choose files")}</button>
          </section>
          <section className="import-section"><div className="section-heading"><h2>{t("Source files")}<span className="count">{data.files.length}</span></h2><span className="muted">{data.scannedAt ? t('Scanned {{time}}', { time: new Date(data.scannedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) }) : ''}</span></div>
            {data.files.map((file) => <article className="file-row" key={file.name}><span className={`file-icon ${file.error ? 'failed' : ''}`}>{file.error ? <CircleAlert size={22} /> : <FileCheck2 size={22} />}</span><div><strong>{file.name}</strong><small>{file.error ? localizeError(file.error, t) : t('{{added}} transactions / {{duplicates}} duplicates skipped', { added: number(file.added), duplicates: number(file.duplicates) })}</small>{file.warnings?.map((warning) => <small className="warning-text" key={warning}>{localizeError(warning, t)}</small>)}</div><span className={`status-badge ${file.error ? 'failed' : ''}`}>{file.error ? t("Not imported") : t("Imported")}</span></article>)}
            {!data.files.length && <div className="empty-small">{t("No source files yet.")}</div>}
          </section>
        </> : !data.transactions.length ? <section className="empty-state"><Wallet size={38} /><h2>{busy ? t("Loading your accounts") : t("No transactions yet")}</h2>{busy ? <LoaderCircle size={22} className="spin" /> : <button className="button primary" onClick={() => fileInput.current.click()}><Upload size={16} />{t("Import CSV")}</button>}</section> : <>
          <div className="filter-bar"><div className="period-controls"><span className="filter-label">{t("Period")}</span><div className="segmented" aria-label={t("Date range")}>{[['1', t("1M")], ['3', t("3M")], ['12', t("1Y")], ['ALL', t("All time")]].map(([value, label]) => <button key={value} aria-pressed={range.preset === value} className={range.preset === value ? 'selected' : ''} onClick={() => { setRange({ start: '', end: '', preset: value }); setPage(0) }}>{label}</button>)}</div></div><div className="date-controls"><label><span className="sr-only">{t("Start date")}</span><input aria-label={t("Start date")} type="date" value={start} onChange={(event) => { setRange({ start: event.target.value, end, preset: 'CUSTOM' }); setPage(0) }} /></label><span className="date-divider">{t("to")}</span><label><span className="sr-only">{t("End date")}</span><input aria-label={t("End date")} type="date" value={end} onChange={(event) => { setRange({ start, end: event.target.value, preset: 'CUSTOM' }); setPage(0) }} /></label><select aria-label={t("Currency")} value={activeCurrency} onChange={(event) => { setCurrency(event.target.value); setSelection(null); setRange({ start: '', end: '', preset: 'ALL' }); setPage(0) }}>{currencies.map((unit) => <option key={unit}>{unit}</option>)}</select></div></div>
          {invalidRange && <div className="banner error" role="alert"><CircleAlert size={17} />{t("The start date must be on or before the end date.")}</div>}
          {!activeIds.length && <div className="banner" role="status"><Landmark size={17} />{t("No accounts selected.")}</div>}
          {view !== 'transactions' && period.internalTransfers.length > 0 && <div className="transfer-summary"><ArrowLeftRight size={16} /><span>{t('{{count}} internal transfer entries excluded', { count: period.internalTransfers.length })}<span className="transfer-totals">{t('{{outgoing}} out / {{incoming}} in', { outgoing: money(period.transferOutgoing), incoming: money(period.transferIncoming) })}</span></span><button className="text-button" onClick={viewTransfers}>{t("View transfers")}<ArrowRight size={14} /></button></div>}
          {view === 'overview' ? <>
            <section className="metrics" aria-label={t("Financial summary")}>
              <article className="metric"><div className="metric-label">{t("Closing balance")}<Wallet size={16} /></div><strong className="metric-value">{money(totalBalance)}</strong><small>{end ? t('As of {{date}}', { date: shortDate(end, locale) }) : t("No recorded balance")}</small></article>
              <article className="metric"><div className="metric-label">{t("Money in")}<span className="metric-icon green"><ArrowDownLeft size={16} /></span></div><strong className="metric-value">{money(period.incoming)}</strong><small><span className="mini-dot green" />{t("External credits in selected period")}</small></article>
              <article className="metric"><div className="metric-label">{t("Money out")}<span className="metric-icon red"><ArrowUpRight size={16} /></span></div><strong className="metric-value">{money(period.outgoing)}</strong><small><span className="mini-dot red" />{t("External debits in selected period")}</small></article>
              <article className="metric"><div className="metric-label">{t("Net cash flow")}<ChartNoAxesCombined size={16} /></div><strong className={`metric-value ${period.incoming - period.outgoing >= 0 ? 'positive' : 'negative'}`}>{period.incoming > period.outgoing && !privateAmounts ? '+' : ''}{money(period.incoming - period.outgoing)}</strong><small>{t('{{count}} transactions / External activity', { count: period.reportingTransactions.length })}</small></article>
            </section>
            <section className="balance-section"><div className="section-heading"><div><h2>{t("Balance over time")}</h2><p className="section-subtitle">{t('{{count}} selected accounts / Recorded daily closing balances', { count: activeIds.length })}</p></div><div className="segmented chart-modes"><button className={mode === 'accounts' ? 'selected' : ''} aria-pressed={mode === 'accounts'} onClick={() => setMode('accounts')}>{t("By account")}</button><button className={mode === 'combined' ? 'selected' : ''} aria-pressed={mode === 'combined'} onClick={() => setMode('combined')}>{t("Combined")}</button></div></div>
              <div className="chart-legend">{mode === 'combined' ? <span><i style={{ background: colors[0] }} />{t("Combined balance")}</span> : accounts.filter((account) => activeIds.includes(account.id)).map((account) => <span key={account.id}><i style={{ background: colors[accounts.indexOf(account) % colors.length] }} />{accountName(account, t)}</span>)}</div>
              <div className="balance-chart" data-testid="balance-chart">{timeline.length && activeIds.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}>{mode === 'combined' ? <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}><defs><linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#087f70" stopOpacity={0.16} /><stop offset="100%" stopColor="#087f70" stopOpacity={0.01} /></linearGradient></defs>{chartAxes}<Area type="stepAfter" dataKey="total" name={t("Combined balance")} stroke={colors[0]} strokeWidth={2} fill="url(#balanceFill)" isAnimationActive={false} /></AreaChart> : <LineChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>{chartAxes}{accounts.filter((account) => activeIds.includes(account.id)).map((account) => <Line key={account.id} dataKey={account.id} name={accountName(account, t)} type="stepAfter" stroke={colors[accounts.indexOf(account) % colors.length]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}</LineChart>}</ResponsiveContainer> : <div className="empty-small">{t("No balance history for this selection.")}</div>}</div>
              <div className="chart-footer"><span><span className="local-dot" />{activeCurrency} / {t('Daily closing balance')}</span><span>{start && end ? `${shortDate(start, locale)} - ${shortDate(end, locale)}` : ''}</span></div>
            </section>
            <div className="lower-grid"><section className="cashflow-section"><div className="section-heading"><h2>{t("Cash flow")}</h2><span className="muted">{intervalLabel}</span></div><div className="chart-legend"><span><i style={{ background: '#087f70' }} />{t("Money in")}</span><span><i style={{ background: '#e3a9a1' }} />{t("Money out")}</span></div><div className="cashflow-chart">{cashflow.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={cashflow} barGap={2} margin={{ left: -8, right: 0, top: 10, bottom: 0 }}><CartesianGrid vertical={false} stroke="#edf0ee" /><XAxis dataKey="period" tickFormatter={(value) => formatChartPeriod(value, interval, false, locale)} minTickGap={35} tickLine={false} axisLine={false} /><YAxis tickFormatter={privateAmounts ? () => '****' : compact} tickLine={false} axisLine={false} width={56} /><Tooltip content={chartTooltip} cursor={{ fill: '#f3f6f4' }} /><Bar dataKey="incoming" name={t("Money in")} fill="#087f70" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} /><Bar dataKey="outgoing" name={t("Money out")} fill="#e3a9a1" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <div className="empty-small">{t("No cash flow in this period.")}</div>}</div><p className="flow-note">{t("Transfers between imported accounts excluded.")}</p></section>
              <section className="recent-section"><div className="section-heading"><h2>{t("Recent transactions")}</h2><button className="text-button" onClick={() => setView('transactions')}>{t("View all")}<ArrowRight size={14} /></button></div>{transactionTable(sorted.slice(0, 5))}</section></div>
            <CategorySpendingChart transactions={period.reportingTransactions} categorization={categorization} groups={categoryGroups} money={money} formatAxis={privateAmounts ? () => '****' : compact} interval={interval} start={start} end={end} />
            <CategoryBreakdown groups={categoryGroups} money={money} averageMonths={averageMonths} onSelect={viewCategory} onManage={() => setView('categories')} />
          </> : view === 'categories' ? <Categories categorization={categorization} transactions={data.transactions} groups={categoryGroups} money={money} averageMonths={averageMonths} saving={savingCategories} onChange={changeCategories} onSelect={viewCategory} ruleDraft={ruleDraft} setRuleDraft={setRuleDraft} /> : view === 'category' ? selectedCategory ? <CategoryDetail key={detailCategoryId} category={selectedCategory} transactions={reportingSorted.filter((transaction) => transactionCategory(transaction, categorization) === detailCategoryId)} categorization={categorization} money={money} averageMonths={averageMonths} onBack={() => setView('categories')} onViewTransactions={() => viewCategoryTransactions(detailCategoryId)} renderTransactions={transactionTable} /> : <div className="empty-state"><h2>{t("This category no longer exists.")}</h2><button className="text-button" onClick={() => setView('categories')}>{t("All categories")}</button></div> : <section className="transactions-section">
            <div className="transaction-toolbar"><div className="search-field"><Search size={17} /><input type="search" placeholder={regexSearch ? '^AH\\s+(Bemmel|Opheusden)$' : t("Search transactions...")} aria-label={t("Search transactions")} aria-invalid={Boolean(searchFilter.error)} aria-describedby={searchFilter.error ? 'search-regex-error' : undefined} maxLength={regexSearch ? 200 : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /><IconButton title={t("Use regular expression")} aria-pressed={regexSearch} onClick={() => { setRegexSearch(!regexSearch); setPage(0) }}><Regex size={17} /></IconButton></div><div className="transaction-tools"><select aria-label={t("Filter category")} value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(0) }}><option value="all">{t("All categories")}</option><option value="">{t("Uncategorized")}</option>{categorization.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select aria-label={t("Transaction direction")} value={direction} onChange={(event) => { setDirection(event.target.value); setPage(0) }}><option value="all">{t("All transactions")}</option><option value="in">{t("Money in")}</option><option value="out">{t("Money out")}</option></select><IconButton title={t("Export filtered transactions")} disabled={!filtered.length} onClick={exportTransactions}><ArrowDownToLine size={18} /></IconButton></div></div>
            {searchFilter.error && <p id="search-regex-error" className="filter-error" role="alert">{localizeError(searchFilter.error, t)}</p>}
            <div className="transfer-filter-row"><label>{t("Activity")}<select aria-label={t("Transfer filter")} value={transferFilter} onChange={(event) => { setTransferFilter(event.target.value); setPage(0) }}><option value="all">{t("All activity")}</option><option value="external">{t("External activity only")}</option><option value="internal">{t("Internal transfers only")}</option></select></label></div>
            <form className="bulk-category-form" onSubmit={(event) => { event.preventDefault(); changeCategories({ action: 'assign', transactionIds: assignableTransactions.map((transaction) => transaction.id), categoryId: bulkCategory === '__rules__' ? null : bulkCategory }) }}><Tags size={15} /><CategorySelect aria-label={t("Bulk category")} categorization={categorization} includeRules value={bulkCategory} disabled={savingCategories} onChange={(event) => setBulkCategory(event.target.value)} /><button className="button" type="submit" disabled={savingCategories || !assignableTransactions.length || assignableTransactions.length > 10000}><Check size={14} />{t('Assign {{count}} transactions', { count: assignableTransactions.length })}</button></form>
            {transactionTable(filtered.slice(currentPage * 20, (currentPage + 1) * 20), true)}<div className="pagination"><span>{filtered.length ? t('{{start}}-{{end}} of {{total}}', { start: number(currentPage * 20 + 1), end: number(Math.min((currentPage + 1) * 20, filtered.length)), total: number(filtered.length) }) : t('{{count}} transactions', { count: 0 })}</span><div><IconButton title={t("Previous page")} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></IconButton><TransactionPageInput key={`${currentPage}:${pageCount}`} currentPage={currentPage} pageCount={pageCount} onChange={setPage} disabled={!filtered.length} /><IconButton title={t("Next page")} disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></IconButton></div></div>
          </section>}
        </>}
        <footer className="page-footer"><span><ShieldCheck size={14} />{t("Private by design. Stored on this computer.")}</span><span>{t("Financial Overview")}</span></footer>
      </main>
    </div>
    {detail && <TransactionDialog transaction={detail} money={money} onClose={() => setDetail(null)} categorization={categorization} saving={savingCategories} onChange={changeCategories} onCreateRule={createRule} internalTransfer={period.internalTransferIds.has(detail.id)} />}
  </div>
}

export default App