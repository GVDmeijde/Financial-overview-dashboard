import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownLeft, ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpRight, ChartNoAxesCombined, Check, ChevronLeft, ChevronRight, CircleAlert, Eye, EyeOff, FileCheck2, FolderInput, Landmark, LayoutDashboard, ListFilter, LoaderCircle, RefreshCw, Regex, Search, ShieldCheck, Tags, Upload, Wallet, X } from 'lucide-react'
import Papa from 'papaparse'
import { balanceTimeline, cashflowByInterval, chartInterval, compareTransactions, formatChartPeriod, getAccounts, summarizePeriod } from './finance.js'
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
const shortDate = (date) => new Date(typeof date === 'number' ? date : `${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const accountName = (account) => `Account ${account.iban.slice(-4)}`
const compact = (value) => new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value / 100)
const formatMoney = (value, currency = 'EUR') => new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(value / 100)

async function fetchData(signal) {
  const response = await fetch('/api/data', { signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to load transactions')
  return data
}

function IconButton({ title, children, ...props }) {
  return <button className="icon-button" type="button" title={title} aria-label={title} {...props}>{children}</button>
}

function TransactionPageInput({ currentPage, pageCount, onChange, disabled }) {
  const [value, setValue] = useState(String(currentPage + 1))
  function commit() {
    const number = Number(value)
    const next = value.trim() && Number.isInteger(number) ? Math.min(pageCount, Math.max(1, number)) : currentPage + 1
    setValue(String(next))
    onChange(next - 1)
  }
  return <label className="page-jump">Page<input type="number" inputMode="numeric" aria-label="Transaction page" min={1} max={pageCount} step={1} value={value} disabled={disabled} onChange={(event) => setValue(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur() } }} /><span>of {pageCount}</span></label>
}

function TransactionDialog({ transaction, money, onClose, categorization, saving, onChange, onCreateRule, internalTransfer }) {
  const ref = useRef(null)
  useEffect(() => { ref.current.showModal() }, [])
  return <dialog ref={ref} onClose={onClose} className="transaction-dialog" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="section-heading"><h2>Transaction details</h2><IconButton title="Close details" onClick={onClose}><X size={19} /></IconButton></div>
    <div className={`detail-amount ${transaction.amount >= 0 ? 'positive' : ''}`}>{money(transaction.amount, transaction.currency)}</div>
    <h3>{transaction.counterparty || 'Bank transaction'}</h3>
    {internalTransfer ? <div className="dialog-category"><span className="transfer-badge"><ArrowLeftRight size={14} />Internal transfer</span><p className="section-subtitle">Excluded from spending and cash flow</p></div> : <div className="dialog-category"><label>Category<CategorySelect categorization={categorization} includeRules value={transactionCategory(transaction, categorization)} disabled={saving} onChange={(event) => onChange({ action: 'assign', transactionIds: [transaction.id], categoryId: event.target.value === '__rules__' ? null : event.target.value })} /></label><div><span className="muted">{saving ? 'Saving...' : Object.hasOwn(categorization.assignments, transaction.id) ? 'Manual assignment' : 'Automatic / Rules'}</span><button className="text-button" disabled={saving || (!transaction.counterparty && !transaction.counterAccount && !transaction.description)} onClick={() => onCreateRule(transaction)}><Tags size={14} />Create rule</button></div></div>}
    <dl>{[
      ['Date', shortDate(transaction.date)], ['Account', transaction.account], ['Counterparty account', transaction.counterAccount || 'Not provided'],
      ['Description', transaction.description || 'Not provided'], ['Balance after transaction', money(transaction.balance, transaction.currency)],
      ['Sequence', transaction.sequence], ['Source file', transaction.source],
    ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </dialog>
}

function App() {
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
  const viewLabel = { overview: 'Overview', transactions: 'Transactions', categories: 'Categories', category: 'Category details', imports: 'Imports' }[view]

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
  const timeline = balanceTimeline(data.transactions, activeIds, start, end)
  const chartData = timeline.map((point) => ({ ...point, timestamp: Date.parse(`${point.date}T00:00:00Z`), total: activeIds.length && activeIds.every((id) => point[id] !== undefined) ? activeIds.reduce((sum, id) => sum + point[id], 0) : null }))
  const closing = timeline.at(-1) || {}
  const totalBalance = activeIds.length && activeIds.every((id) => closing[id] !== undefined) ? activeIds.reduce((sum, id) => sum + closing[id], 0) : null
  const period = summarizePeriod(data.transactions, activeIds, start, end)
  const categoryGroups = categorySummary(period.reportingTransactions, categorization)
  const selectedCategory = categoryGroups.find((category) => category.id === detailCategoryId)
  const money = (value, unit = activeCurrency) => privateAmounts ? '****' : value == null ? '--' : formatMoney(value, unit)
  const interval = chartInterval(start, end, range.preset)
  const intervalLabel = { day: 'Daily', week: 'Weekly', month: 'Monthly' }[interval]
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

  function toggleAccount(id) {
    const next = new Set(activeIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelection([...next])
    setPage(0)
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
        failures.push(`${file.name}: ${failure.message}`)
      }
    }
    await loadData()
    setNotice(added ? `${added.toLocaleString()} transactions imported` : failures.length ? '' : 'All transactions already imported')
    if (failures.length) setError(failures.join('; '))
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
      <thead><tr><th>Transaction</th><th>Date</th>{full && <><th>Account</th><th className="category-column">Category</th></>}<th className="number">Amount</th>{full && <th className="number">Balance</th>}<th><span className="sr-only">Details</span></th></tr></thead>
      <tbody>{rows.map((transaction) => <tr key={transaction.id}>
        <td><button className="transaction-name" onClick={() => setDetail(transaction)}><span className={`transaction-icon ${period.internalTransferIds.has(transaction.id) ? 'transfer' : transaction.amount >= 0 ? 'credit' : 'debit'}`}>{period.internalTransferIds.has(transaction.id) ? <ArrowLeftRight size={17} /> : transaction.amount >= 0 ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span><span><strong>{transaction.counterparty || 'Bank transaction'}</strong><small>{period.internalTransferIds.has(transaction.id) ? 'Internal transfer / ' : ''}{transaction.description || transaction.counterAccount || 'No description'}</small></span></button></td>
        <td className="date-cell">{shortDate(transaction.date)}</td>
        {full && <td className="account-cell"><i style={{ background: colors[accounts.findIndex((account) => account.id === transaction.accountId) % colors.length] }} />{transaction.account.slice(-4)}</td>}
        {full && <td className="category-column">{period.internalTransferIds.has(transaction.id) ? <span className="transfer-badge"><ArrowLeftRight size={12} />Internal transfer</span> : <CategorySelect className="transaction-category" aria-label={`Category for transaction ${transaction.id}`} categorization={categorization} includeRules value={transactionCategory(transaction, categorization)} disabled={savingCategories} onChange={(event) => changeCategories({ action: 'assign', transactionIds: [transaction.id], categoryId: event.target.value === '__rules__' ? null : event.target.value })} />}</td>}
        <td className={`number amount ${transaction.amount > 0 ? 'positive' : ''}`}>{transaction.amount > 0 && !privateAmounts ? '+' : ''}{money(transaction.amount)}</td>
        {full && <td className="number amount">{money(transaction.balance)}</td>}
        <td><IconButton title="View transaction details" onClick={() => setDetail(transaction)}><ChevronRight size={16} /></IconButton></td>
      </tr>)}</tbody>
    </table>{!rows.length && <div className="empty-small">No transactions match these filters.</div>}</div>
  }

  const chartTooltip = ({ active, payload, label }) => active && payload?.length ? <div className="chart-tooltip"><strong>{typeof label === 'number' ? shortDate(label) : formatChartPeriod(String(label), interval, true)}</strong>{payload.map((item) => <div key={item.dataKey}><span><i style={{ background: item.color }} />{item.name}</span><b>{money(item.value)}</b></div>)}</div> : null

  const chartAxes = <><CartesianGrid vertical={false} stroke="#e7ece9" strokeDasharray="3 4" /><XAxis dataKey="timestamp" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(value) => new Date(value).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })} minTickGap={65} axisLine={false} tickLine={false} tickMargin={12} /><YAxis tickFormatter={privateAmounts ? () => '****' : compact} axisLine={false} tickLine={false} width={60} /><Tooltip content={chartTooltip} /></>

  return <div className="app-shell">
    <input ref={fileInput} type="file" accept=".csv,text/csv" multiple className="sr-only" tabIndex={-1} onChange={(event) => importFiles([...event.target.files])} />
    <aside className="sidebar">
      <a className="brand" href="#overview" onClick={(event) => { event.preventDefault(); setView('overview') }}><span className="brand-icon"><ChartNoAxesCombined size={22} strokeWidth={2.3} /></span><span>Financial<span className="brand-second">Overview</span></span></a>
      <div className="mobile-privacy"><IconButton title={privateAmounts ? 'Show amounts' : 'Hide amounts'} onClick={() => setPrivateAmounts(!privateAmounts)}>{privateAmounts ? <EyeOff size={18} /> : <Eye size={18} />}</IconButton></div>
      <div className="workspace"><span className="workspace-avatar">K</span><span><strong>Personal workspace</strong><small>Local finances</small></span><ShieldCheck size={16} /></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{[
        ['overview', LayoutDashboard, 'Overview'], ['transactions', ListFilter, 'Transactions'], ['categories', Tags, 'Categories'], ['imports', FolderInput, 'Imports'],
      ].map(([key, Icon, label]) => <button key={key} className={view === key || (view === 'category' && key === 'categories') ? 'nav-item active' : 'nav-item'} onClick={() => setView(key)}><Icon size={18} /><span>{label}</span>{key === 'imports' && <span className="nav-count">{data.files.length}</span>}</button>)}</nav>
      <div className="accounts-label"><span className="nav-label">BANK ACCOUNTS</span><button className="text-button" onClick={() => { setSelection(null); setPage(0) }}>Select all</button></div>
      <div className="account-list">{accounts.map((account, index) => <label className={`account-option ${activeIds.includes(account.id) ? 'selected' : ''}`} key={account.id}>
        <input type="checkbox" checked={activeIds.includes(account.id)} onChange={() => toggleAccount(account.id)} aria-label={`Include ${accountName(account)}`} />
        <span className="account-top"><span className="bank-icon" style={{ color: colors[index % colors.length], background: `${colors[index % colors.length]}12` }}><Landmark size={17} /></span><span><strong>{accountName(account)}</strong><small>{account.iban.replace(/(.{4})/g, '$1 ').trim()}</small></span><span className="account-check" style={{ '--account-color': colors[index % colors.length] }}>{activeIds.includes(account.id) && <Check size={12} />}</span></span>
        <span className="account-balance">{money(account.balance, account.currency)}<small>{shortDate(account.lastDate)}</small></span>
      </label>)}</div>
      <div className="sidebar-bottom"><span className="local-dot" /><span>Local workspace</span><ShieldCheck size={15} /></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Workspace <ChevronRight size={13} /><strong>{viewLabel}</strong></div><div className="topbar-actions"><span className="local-badge"><ShieldCheck size={14} /> Local only</span><IconButton title={privateAmounts ? 'Show amounts' : 'Hide amounts'} onClick={() => setPrivateAmounts(!privateAmounts)}>{privateAmounts ? <EyeOff size={18} /> : <Eye size={18} />}</IconButton><span className="avatar">K</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow">YOUR MONEY, IN PERSPECTIVE</div><h1>{view === 'overview' ? 'Financial overview' : view === 'imports' ? 'Import history' : view === 'category' ? selectedCategory?.name || 'Category unavailable' : viewLabel}</h1><p>{view === 'imports' ? `${data.files.length} source files in your import folder` : `${allAccounts.length} bank accounts${earliest ? ` / ${shortDate(earliest)} to ${shortDate(latest)}` : ''}`}</p></div><div className="heading-actions"><IconButton title="Rescan import folder" disabled={busy || savingCategories} onClick={() => { setNotice(''); loadData() }}><RefreshCw size={17} className={busy ? 'spin' : ''} /></IconButton><button className="button primary" disabled={busy || savingCategories} onClick={() => fileInput.current.click()}><Upload size={16} />Import CSV</button></div></div>
        {error && <div className="banner error" role="alert"><CircleAlert size={18} /><span>{error}</span><IconButton title="Dismiss error" onClick={() => setError('')}><X size={16} /></IconButton></div>}
        {notice && <div className="banner success" role="status"><Check size={18} /><span>{notice}</span><IconButton title="Dismiss notification" onClick={() => setNotice('')}><X size={16} /></IconButton></div>}
        {warnings.length > 0 && view !== 'imports' && <button className="warning-link" onClick={() => setView('imports')}><CircleAlert size={15} />{warnings.length} source file{warnings.length !== 1 ? 's' : ''} with import notices<ArrowRight size={14} /></button>}
        {view === 'imports' ? <>
          <section className={`upload-zone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); importFiles([...event.dataTransfer.files]) }}>
            <div className="upload-symbol"><FolderInput size={30} /></div><h2>Import bank statements</h2><p>Rabobank CSV exports / Up to 20 MB per file</p><button className="button" disabled={busy} onClick={() => fileInput.current.click()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}Choose files</button>
          </section>
          <section className="import-section"><div className="section-heading"><h2>Source files <span className="count">{data.files.length}</span></h2><span className="muted">{data.scannedAt ? `Scanned ${new Date(data.scannedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</span></div>
            {data.files.map((file) => <article className="file-row" key={file.name}><span className={`file-icon ${file.error ? 'failed' : ''}`}>{file.error ? <CircleAlert size={22} /> : <FileCheck2 size={22} />}</span><div><strong>{file.name}</strong><small>{file.error || `${file.added.toLocaleString()} transactions / ${file.duplicates.toLocaleString()} duplicates skipped`}</small>{file.warnings?.map((warning) => <small className="warning-text" key={warning}>{warning}</small>)}</div><span className={`status-badge ${file.error ? 'failed' : ''}`}>{file.error ? 'Not imported' : 'Imported'}</span></article>)}
            {!data.files.length && <div className="empty-small">No source files yet.</div>}
          </section>
        </> : !data.transactions.length ? <section className="empty-state"><Wallet size={38} /><h2>{busy ? 'Loading your accounts' : 'No transactions yet'}</h2>{busy ? <LoaderCircle size={22} className="spin" /> : <button className="button primary" onClick={() => fileInput.current.click()}><Upload size={16} />Import CSV</button>}</section> : <>
          <div className="filter-bar"><div className="period-controls"><span className="filter-label">Period</span><div className="segmented" aria-label="Date range">{[['1', '1M'], ['3', '3M'], ['12', '1Y'], ['ALL', 'All time']].map(([value, label]) => <button key={value} aria-pressed={range.preset === value} className={range.preset === value ? 'selected' : ''} onClick={() => { setRange({ start: '', end: '', preset: value }); setPage(0) }}>{label}</button>)}</div></div><div className="date-controls"><label><span className="sr-only">Start date</span><input aria-label="Start date" type="date" value={start} onChange={(event) => { setRange({ start: event.target.value, end, preset: 'CUSTOM' }); setPage(0) }} /></label><span className="date-divider">to</span><label><span className="sr-only">End date</span><input aria-label="End date" type="date" value={end} onChange={(event) => { setRange({ start, end: event.target.value, preset: 'CUSTOM' }); setPage(0) }} /></label><select aria-label="Currency" value={activeCurrency} onChange={(event) => { setCurrency(event.target.value); setSelection(null); setRange({ start: '', end: '', preset: 'ALL' }); setPage(0) }}>{currencies.map((unit) => <option key={unit}>{unit}</option>)}</select></div></div>
          {invalidRange && <div className="banner error" role="alert"><CircleAlert size={17} />The start date must be on or before the end date.</div>}
          {!activeIds.length && <div className="banner" role="status"><Landmark size={17} />No accounts selected.</div>}
          {view !== 'transactions' && period.internalTransfers.length > 0 && <div className="transfer-summary"><ArrowLeftRight size={16} /><span>{period.internalTransfers.length.toLocaleString()} internal transfer entries excluded<span className="transfer-totals">{money(period.transferOutgoing)} out / {money(period.transferIncoming)} in</span></span><button className="text-button" onClick={viewTransfers}>View transfers<ArrowRight size={14} /></button></div>}
          {view === 'overview' ? <>
            <section className="metrics" aria-label="Financial summary">
              <article className="metric"><div className="metric-label">Closing balance <Wallet size={16} /></div><strong className="metric-value">{money(totalBalance)}</strong><small>{end ? `As of ${shortDate(end)}` : 'No recorded balance'}</small></article>
              <article className="metric"><div className="metric-label">Money in <span className="metric-icon green"><ArrowDownLeft size={16} /></span></div><strong className="metric-value">{money(period.incoming)}</strong><small><span className="mini-dot green" />External credits in selected period</small></article>
              <article className="metric"><div className="metric-label">Money out <span className="metric-icon red"><ArrowUpRight size={16} /></span></div><strong className="metric-value">{money(period.outgoing)}</strong><small><span className="mini-dot red" />External debits in selected period</small></article>
              <article className="metric"><div className="metric-label">Net cash flow <ChartNoAxesCombined size={16} /></div><strong className={`metric-value ${period.incoming - period.outgoing >= 0 ? 'positive' : 'negative'}`}>{period.incoming > period.outgoing && !privateAmounts ? '+' : ''}{money(period.incoming - period.outgoing)}</strong><small>{period.reportingTransactions.length.toLocaleString()} transactions / External activity</small></article>
            </section>
            <section className="balance-section"><div className="section-heading"><div><h2>Balance over time</h2><p className="section-subtitle">{activeIds.length} selected accounts / Recorded daily closing balances</p></div><div className="segmented chart-modes"><button className={mode === 'accounts' ? 'selected' : ''} aria-pressed={mode === 'accounts'} onClick={() => setMode('accounts')}>By account</button><button className={mode === 'combined' ? 'selected' : ''} aria-pressed={mode === 'combined'} onClick={() => setMode('combined')}>Combined</button></div></div>
              <div className="chart-legend">{mode === 'combined' ? <span><i style={{ background: colors[0] }} />Combined balance</span> : accounts.filter((account) => activeIds.includes(account.id)).map((account) => <span key={account.id}><i style={{ background: colors[accounts.indexOf(account) % colors.length] }} />{accountName(account)}</span>)}</div>
              <div className="balance-chart" data-testid="balance-chart">{timeline.length && activeIds.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}>{mode === 'combined' ? <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}><defs><linearGradient id="balanceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#087f70" stopOpacity={0.16} /><stop offset="100%" stopColor="#087f70" stopOpacity={0.01} /></linearGradient></defs>{chartAxes}<Area type="stepAfter" dataKey="total" name="Combined balance" stroke={colors[0]} strokeWidth={2} fill="url(#balanceFill)" isAnimationActive={false} /></AreaChart> : <LineChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>{chartAxes}{accounts.filter((account) => activeIds.includes(account.id)).map((account) => <Line key={account.id} dataKey={account.id} name={accountName(account)} type="stepAfter" stroke={colors[accounts.indexOf(account) % colors.length]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}</LineChart>}</ResponsiveContainer> : <div className="empty-small">No balance history for this selection.</div>}</div>
              <div className="chart-footer"><span><span className="local-dot" />{activeCurrency} / Daily closing balance</span><span>{start && end ? `${shortDate(start)} - ${shortDate(end)}` : ''}</span></div>
            </section>
            <div className="lower-grid"><section className="cashflow-section"><div className="section-heading"><h2>Cash flow</h2><span className="muted">{intervalLabel}</span></div><div className="chart-legend"><span><i style={{ background: '#087f70' }} />Money in</span><span><i style={{ background: '#e3a9a1' }} />Money out</span></div><div className="cashflow-chart">{cashflow.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}><BarChart data={cashflow} barGap={2} margin={{ left: -8, right: 0, top: 10, bottom: 0 }}><CartesianGrid vertical={false} stroke="#edf0ee" /><XAxis dataKey="period" tickFormatter={(value) => formatChartPeriod(value, interval)} minTickGap={35} tickLine={false} axisLine={false} /><YAxis tickFormatter={privateAmounts ? () => '****' : compact} tickLine={false} axisLine={false} width={56} /><Tooltip content={chartTooltip} cursor={{ fill: '#f3f6f4' }} /><Bar dataKey="incoming" name="Money in" fill="#087f70" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} /><Bar dataKey="outgoing" name="Money out" fill="#e3a9a1" radius={[2, 2, 0, 0]} maxBarSize={14} isAnimationActive={false} /></BarChart></ResponsiveContainer> : <div className="empty-small">No cash flow in this period.</div>}</div><p className="flow-note">Transfers between imported accounts excluded.</p></section>
              <section className="recent-section"><div className="section-heading"><h2>Recent transactions</h2><button className="text-button" onClick={() => setView('transactions')}>View all <ArrowRight size={14} /></button></div>{transactionTable(sorted.slice(0, 5))}</section></div>
            <CategorySpendingChart transactions={period.reportingTransactions} categorization={categorization} groups={categoryGroups} money={money} formatAxis={privateAmounts ? () => '****' : compact} interval={interval} start={start} end={end} />
            <CategoryBreakdown groups={categoryGroups} money={money} onSelect={viewCategory} onManage={() => setView('categories')} />
          </> : view === 'categories' ? <Categories categorization={categorization} transactions={data.transactions} groups={categoryGroups} money={money} saving={savingCategories} onChange={changeCategories} onSelect={viewCategory} ruleDraft={ruleDraft} setRuleDraft={setRuleDraft} /> : view === 'category' ? selectedCategory ? <CategoryDetail key={detailCategoryId} category={selectedCategory} transactions={reportingSorted.filter((transaction) => transactionCategory(transaction, categorization) === detailCategoryId)} categorization={categorization} money={money} onBack={() => setView('categories')} onViewTransactions={() => viewCategoryTransactions(detailCategoryId)} renderTransactions={transactionTable} /> : <div className="empty-state"><h2>This category no longer exists.</h2><button className="text-button" onClick={() => setView('categories')}>All categories</button></div> : <section className="transactions-section">
            <div className="transaction-toolbar"><div className="search-field"><Search size={17} /><input type="search" placeholder={regexSearch ? '^AH\\s+(Bemmel|Opheusden)$' : 'Search transactions...'} aria-label="Search transactions" aria-invalid={Boolean(searchFilter.error)} aria-describedby={searchFilter.error ? 'search-regex-error' : undefined} maxLength={regexSearch ? 200 : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setPage(0) }} /><IconButton title="Use regular expression" aria-pressed={regexSearch} onClick={() => { setRegexSearch(!regexSearch); setPage(0) }}><Regex size={17} /></IconButton></div><div className="transaction-tools"><select aria-label="Filter category" value={categoryFilter} onChange={(event) => { setCategoryFilter(event.target.value); setPage(0) }}><option value="all">All categories</option><option value="">Uncategorized</option>{categorization.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><select aria-label="Transaction direction" value={direction} onChange={(event) => { setDirection(event.target.value); setPage(0) }}><option value="all">All transactions</option><option value="in">Money in</option><option value="out">Money out</option></select><IconButton title="Export filtered transactions" disabled={!filtered.length} onClick={exportTransactions}><ArrowDownToLine size={18} /></IconButton></div></div>
            {searchFilter.error && <p id="search-regex-error" className="filter-error" role="alert">{searchFilter.error}</p>}
            <div className="transfer-filter-row"><label>Activity<select aria-label="Transfer filter" value={transferFilter} onChange={(event) => { setTransferFilter(event.target.value); setPage(0) }}><option value="all">All activity</option><option value="external">External activity only</option><option value="internal">Internal transfers only</option></select></label></div>
            <form className="bulk-category-form" onSubmit={(event) => { event.preventDefault(); changeCategories({ action: 'assign', transactionIds: assignableTransactions.map((transaction) => transaction.id), categoryId: bulkCategory === '__rules__' ? null : bulkCategory }) }}><Tags size={15} /><CategorySelect aria-label="Bulk category" categorization={categorization} includeRules value={bulkCategory} disabled={savingCategories} onChange={(event) => setBulkCategory(event.target.value)} /><button className="button" type="submit" disabled={savingCategories || !assignableTransactions.length || assignableTransactions.length > 10000}><Check size={14} />Assign {assignableTransactions.length.toLocaleString()} transactions</button></form>
            {transactionTable(filtered.slice(currentPage * 20, (currentPage + 1) * 20), true)}<div className="pagination"><span>{filtered.length ? `${currentPage * 20 + 1}-${Math.min((currentPage + 1) * 20, filtered.length)} of ${filtered.length.toLocaleString()}` : '0 transactions'}</span><div><IconButton title="Previous page" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></IconButton><TransactionPageInput key={`${currentPage}:${pageCount}`} currentPage={currentPage} pageCount={pageCount} onChange={setPage} disabled={!filtered.length} /><IconButton title="Next page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></IconButton></div></div>
          </section>}
        </>}
        <footer className="page-footer"><span><ShieldCheck size={14} />Private by design. Stored on this computer.</span><span>Financial Overview</span></footer>
      </main>
    </div>
    {detail && <TransactionDialog transaction={detail} money={money} onClose={() => setDetail(null)} categorization={categorization} saving={savingCategories} onChange={changeCategories} onCreateRule={createRule} internalTransfer={period.internalTransferIds.has(detail.id)} />}
  </div>
}

export default App