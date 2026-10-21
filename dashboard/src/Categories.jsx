import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Pencil, Plus, Save, Tags, Trash2, X } from 'lucide-react'
import { categorySpendingByInterval, compileFilter, matchesRule, merchantIdentity, merchantSummary } from './categories.js'
import { formatChartPeriod } from './finance.js'

const spendingColors = ['#087f70', '#4285d4', '#bd7b12', '#bb5274', '#7476b9', '#519ea3', '#a46c54', '#7f9154']

function SpendingPie({ groups, money, onSelect, label }) {
  const slices = groups.filter((group) => group.outgoing > 0).map((group, index) => ({ ...group, fill: group.color || spendingColors[index % spendingColors.length] }))
  const total = slices.reduce((sum, group) => sum + group.outgoing, 0)
  if (!total) return <div className="spending-pie empty-small">No spending in this period.</div>
  return <div className="spending-pie" role="group" aria-label={label}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart accessibilityLayer>
      <Pie data={slices} dataKey="outgoing" nameKey="name" cx="50%" cy="50%" innerRadius={76} outerRadius={108} paddingAngle={slices.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false} onClick={(entry) => onSelect(entry.payload?.id ?? entry.id)} />
      <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="chart-tooltip"><strong>{payload[0].name}</strong><div><b>{money(payload[0].value)}</b><span>{(payload[0].value / total * 100).toFixed(1)}%</span></div></div> : null} />
    </PieChart></ResponsiveContainer>
    <div className="pie-total"><small>Total spent</small><strong>{money(total)}</strong></div>
  </div>
}

export function CategorySpendingChart({ transactions, categorization, groups, money, formatAxis, interval = 'month', start, end }) {
  const buckets = categorySpendingByInterval(transactions, categorization, interval, start, end)
  const series = groups.filter((category) => category.outgoing > 0)
  const intervalLabel = { day: 'Daily', week: 'Weekly', month: 'Monthly' }[interval]
  return <section className="monthly-category-section" aria-label={`${intervalLabel} spending by category`}>
    <div className="section-heading"><div><h2>{intervalLabel} spending by category</h2><p className="section-subtitle">External debits / Selected accounts and period</p></div><span className="muted">{intervalLabel}</span></div>
    <div className="chart-legend">{series.map((category) => <span key={category.id}><i style={{ background: category.color }} />{category.name}</span>)}</div>
    <div className="monthly-category-chart">{buckets.length && series.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={buckets} margin={{ top: 12, right: 8, left: 0, bottom: 4 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="#e7ece9" strokeDasharray="3 4" />
        <XAxis dataKey="period" tickFormatter={(value) => formatChartPeriod(value, interval)} minTickGap={35} tickLine={false} axisLine={false} tickMargin={10} />
        <YAxis tickFormatter={formatAxis} width={60} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: '#e8eeea88' }} content={({ active, payload }) => {
          const point = payload?.[0]?.payload
          if (!active || !point) return null
          return <div className="chart-tooltip category-spending-tooltip"><strong>{formatChartPeriod(point.period, interval, true)}</strong>{series.filter((category) => point.categories[category.id] > 0).map((category) => <div key={category.id}><span><i style={{ background: category.color }} />{category.name}</span><b>{money(point.categories[category.id])}</b></div>)}<div className="chart-tooltip-total"><span>Total money out</span><b>{money(point.total)}</b></div></div>
        }} />
        {series.map((category) => <Bar key={category.id} dataKey={(point) => point.categories[category.id]} name={category.name} stackId="category-spending" fill={category.color} maxBarSize={42} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer> : <div className="empty-small">No spending in this period.</div>}</div>
    <p className="flow-note">Transfers between imported accounts excluded. Credits and refunds are separate from spending.</p>
  </section>
}

export function CategorySelect({ categorization, includeRules = false, ...props }) {
  return <select {...props}><option value="">Uncategorized</option>{categorization.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}{includeRules && <option value="__rules__">Use rules (clear override)</option>}</select>
}

export function CategoryBreakdown({ groups, money, onSelect, onManage, averageMonths = 1 }) {
  const total = groups.reduce((sum, group) => sum + group.outgoing, 0)
  return <section className="category-breakdown">
    <div className="section-heading"><div><h2>Spending by category</h2><p className="section-subtitle">Gross debits / Selected accounts and period</p></div>{onManage ? <button className="text-button" onClick={onManage}><Tags size={14} />Manage categories</button> : <strong className="category-total">{money(total)}</strong>}</div>
    <div className="category-spending-grid"><SpendingPie groups={groups} money={money} onSelect={onSelect} label="Category spending pie chart" />
    <div className="category-summary">{groups.map((group) => <button className="category-summary-row" key={group.id} onClick={() => onSelect(group.id)}>
      <span className="category-summary-label"><i style={{ background: group.color }} /><span><strong>{group.name}</strong><small>{group.count.toLocaleString()} transactions</small></span></span>
      <span className="category-meter"><span style={{ width: `${total ? group.outgoing / total * 100 : 0}%`, background: group.color }} /></span>
      <span className="category-summary-amount"><strong>{money(group.outgoing)}</strong><small>{total ? (group.outgoing / total * 100).toFixed(1) : '0.0'}%</small><small className="monthly-average">Avg {money(averageMonths ? group.outgoing / averageMonths : null)} / mo</small></span><ArrowRight size={14} />
    </button>)}</div></div>
  </section>
}

export function CategoryDetail({ category, transactions, categorization, money, averageMonths = 1, onBack, onViewTransactions, renderTransactions }) {
  const [merchantId, setMerchantId] = useState('all')
  const [page, setPage] = useState(0)
  const merchants = merchantSummary(transactions, categorization, category.id).map((merchant, index) => ({ ...merchant, color: spendingColors[index % spendingColors.length] }))
  const selectedMerchant = merchants.find((merchant) => merchant.id === merchantId)
  const selectedId = selectedMerchant ? merchantId : 'all'
  const rows = transactions.filter((transaction) => selectedId === 'all' || merchantIdentity(transaction).id === selectedId)
  const pageCount = Math.max(1, Math.ceil(rows.length / 20))
  const currentPage = Math.min(page, pageCount - 1)
  const selectMerchant = (id) => { setMerchantId(id); setPage(0) }
  return <div className="category-detail">
    <div className="category-detail-actions"><button className="text-button" onClick={onBack}><ArrowLeft size={15} />All categories</button><button className="text-button" onClick={onViewTransactions}>Open in transactions<ArrowRight size={14} /></button></div>
    <section className="metrics" aria-label="Category summary">
      <article className="metric"><div className="metric-label">Total spent</div><strong className="metric-value">{money(category.outgoing)}</strong><small>Gross debits in selected period</small></article>
      <article className="metric"><div className="metric-label">Money returned / Credits</div><strong className="metric-value positive">{money(category.incoming)}</strong><small>Credits are separate from spending</small></article>
      <article className="metric"><div className="metric-label">Transactions</div><strong className="metric-value">{category.count.toLocaleString()}</strong><small>All payments and credits</small></article>
      <article className="metric"><div className="metric-label">Monthly average</div><strong className="metric-value">{money(averageMonths ? category.outgoing / averageMonths : null)}</strong><small>Average external spending / month</small></article>
    </section>
    <section className="category-merchant-section"><div className="section-heading"><div><h2>Where the money goes</h2><p className="section-subtitle">{category.name} / Gross debits by counterparty</p></div><span className="muted">{merchants.length} groups</span></div>
      <div className="category-spending-grid"><SpendingPie groups={merchants} money={money} onSelect={selectMerchant} label="Merchant spending pie chart" />
        <div className="merchant-list">{merchants.map((merchant) => <button className={`merchant-summary-row ${selectedId === merchant.id ? 'selected' : ''}`} aria-pressed={selectedId === merchant.id} key={merchant.id} onClick={() => selectMerchant(merchant.id)}>
          <i style={{ background: merchant.color }} /><span><strong>{merchant.name}</strong><small>{merchant.count.toLocaleString()} transactions{merchant.incoming ? ` / Credits ${money(merchant.incoming)}` : ''}</small></span><span className="category-summary-amount"><strong>{money(merchant.outgoing)}</strong><small>{category.outgoing ? (merchant.outgoing / category.outgoing * 100).toFixed(1) : '0.0'}%</small><small className="monthly-average">Avg {money(averageMonths ? merchant.outgoing / averageMonths : null)} / mo</small></span><ChevronRight size={15} />
        </button>)}{!merchants.length && <div className="empty-small">No transactions in this category for this period.</div>}</div>
      </div>
    </section>
    <section className="transactions-section category-detail-transactions"><div className="section-heading"><div><h2>{selectedMerchant?.name || 'All category transactions'}</h2><p className="section-subtitle">{rows.length.toLocaleString()} transactions</p></div><select aria-label="Filter merchant" value={selectedId} onChange={(event) => selectMerchant(event.target.value)}><option value="all">All counterparties</option>{merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.name}</option>)}</select></div>
      {renderTransactions(rows.slice(currentPage * 20, (currentPage + 1) * 20), true)}
      <div className="pagination"><span>{rows.length ? `${currentPage * 20 + 1}-${Math.min((currentPage + 1) * 20, rows.length)} of ${rows.length.toLocaleString()}` : '0 transactions'}</span><div><button className="icon-button" title="Previous category page" aria-label="Previous category page" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button><span>Page {currentPage + 1} of {pageCount}</span><button className="icon-button" title="Next category page" aria-label="Next category page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></div></div>
    </section>
  </div>
}

function DeleteButton({ title, disabled, onDelete }) {
  const [confirm, setConfirm] = useState(false)
  return confirm ? <span className="delete-confirmation"><span>Delete?</span><button type="button" className="icon-button danger" title={`Confirm ${title.toLowerCase()}`} aria-label={`Confirm ${title.toLowerCase()}`} disabled={disabled} onClick={async () => { if (await onDelete()) setConfirm(false) }}><Check size={16} /></button><button type="button" className="icon-button" title="Cancel deletion" aria-label="Cancel deletion" disabled={disabled} onClick={() => setConfirm(false)}><X size={16} /></button></span> : <button type="button" className="icon-button" title={title} aria-label={title} disabled={disabled} onClick={() => setConfirm(true)}><Trash2 size={16} /></button>
}

function CategoryEditor({ category, saving, onChange }) {
  const [name, setName] = useState(category.name)
  const [color, setColor] = useState(category.color)
  const changed = name !== category.name || color !== category.color
  return <form className="category-editor" onSubmit={(event) => { event.preventDefault(); onChange({ action: 'saveCategory', category: { ...category, name, color } }) }}>
    <input type="color" aria-label={`Color for ${category.name}`} value={color} disabled={saving} onChange={(event) => setColor(event.target.value)} />
    <input aria-label={`Name for ${category.name}`} value={name} required maxLength={60} disabled={saving} onChange={(event) => setName(event.target.value)} />
    <button className="icon-button" type="submit" title={`Save ${category.name}`} aria-label={`Save ${category.name}`} disabled={saving || !changed}><Save size={16} /></button>
    <DeleteButton title={`Delete ${category.name} and its rules`} disabled={saving} onDelete={() => onChange({ action: 'deleteCategory', id: category.id })} />
  </form>
}

export function Categories({ categorization, transactions, groups, money, averageMonths, saving, onChange, onSelect, ruleDraft, setRuleDraft }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#647762')
  const [ruleCategory, setRuleCategory] = useState('all')
  const [rulePage, setRulePage] = useState(0)
  const [rulesPerPage, setRulesPerPage] = useState(10)
  const activeRuleCategory = categorization.categories.some((category) => category.id === ruleCategory) ? ruleCategory : 'all'
  const filteredRules = categorization.rules.filter((rule) => activeRuleCategory === 'all' || rule.categoryId === activeRuleCategory)
  const rulePageCount = Math.max(1, Math.ceil(filteredRules.length / rulesPerPage))
  const currentRulePage = Math.min(rulePage, rulePageCount - 1)
  const visibleRules = filteredRules.slice(currentRulePage * rulesPerPage, (currentRulePage + 1) * rulesPerPage)
  const draft = { ...ruleDraft, categoryId: categorization.categories.some((category) => category.id === ruleDraft.categoryId) ? ruleDraft.categoryId : categorization.categories[0]?.id || '' }
  const filter = compileFilter(draft.value, draft.matchType, draft.field === 'counterAccount')
  const matches = transactions.filter((transaction) => matchesRule(transaction, draft))
  const fieldNames = { counterparty: 'Counterparty', description: 'Description', counterAccount: 'Counterparty account' }
  const directionNames = { out: 'Money out', in: 'Money in', all: 'All transactions' }
  const resetRule = () => setRuleDraft({ field: 'counterparty', matchType: 'text', value: '', direction: 'out', categoryId: draft.categoryId })
  return <>
    <CategoryBreakdown groups={groups} money={money} averageMonths={averageMonths} onSelect={onSelect} />
    <div className="category-management">
      <section className="category-definitions"><div className="section-heading"><h2>Categories <span className="count">{categorization.categories.length}</span></h2></div>
        <div className="category-editors">{categorization.categories.map((category) => <CategoryEditor key={`${category.id}:${category.name}:${category.color}`} category={category} saving={saving} onChange={onChange} />)}</div>
        <form className="new-category-form" onSubmit={async (event) => { event.preventDefault(); if (await onChange({ action: 'saveCategory', category: { name, color } })) setName('') }}>
          <label htmlFor="new-category-name">New category</label><div><input type="color" aria-label="New category color" value={color} disabled={saving} onChange={(event) => setColor(event.target.value)} /><input id="new-category-name" value={name} placeholder="Category name" required maxLength={60} disabled={saving} onChange={(event) => setName(event.target.value)} /><button className="icon-button" type="submit" title="Add category" aria-label="Add category" disabled={saving || !name.trim()}><Plus size={19} /></button></div>
        </form>
      </section>
      <section className="category-rules"><div className="section-heading"><h2>{draft.id ? 'Edit rule' : 'New rule'}</h2>{draft.id && <button className="text-button" disabled={saving} onClick={resetRule}><X size={14} />Cancel edit</button>}</div>
        <form className="rule-form" onSubmit={async (event) => { event.preventDefault(); if (await onChange({ action: 'saveRule', rule: draft })) { resetRule(); setRulePage(0) } }}>
          <div className="rule-fields"><label>Match field<select value={draft.field} disabled={saving} onChange={(event) => setRuleDraft({ ...draft, field: event.target.value })}>{Object.entries(fieldNames).map(([value, label]) => <option value={value} key={value}>{label}{draft.matchType === 'regex' ? '' : value === 'counterAccount' ? ' equals' : ' contains'}</option>)}</select></label><label>Direction<select value={draft.direction} disabled={saving} onChange={(event) => setRuleDraft({ ...draft, direction: event.target.value })}>{Object.entries(directionNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          <label>Match type<select aria-label="Rule match type" value={draft.matchType || 'text'} disabled={saving} onChange={(event) => setRuleDraft({ ...draft, matchType: event.target.value })}><option value="text">Plain text</option><option value="regex">Regular expression (RE2)</option></select></label>
          <label>{draft.matchType === 'regex' ? 'Pattern (case-insensitive)' : 'Match text'}<input aria-label="Rule match text" aria-invalid={Boolean(filter.error)} aria-describedby={filter.error ? 'rule-regex-error' : undefined} className={draft.matchType === 'regex' ? 'regex-input' : ''} value={draft.value} maxLength={200} required disabled={saving} onChange={(event) => setRuleDraft({ ...draft, value: event.target.value })} /></label>
          {filter.error && <p id="rule-regex-error" className="filter-error" role="alert">{filter.error}</p>}
          <label>Assign category<select value={draft.categoryId} required disabled={saving || !categorization.categories.length} onChange={(event) => setRuleDraft({ ...draft, categoryId: event.target.value })}>{categorization.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <div className="rule-preview"><span>{matches.length.toLocaleString()} matches / All imported transactions</span>{matches.slice(-3).reverse().map((transaction) => <div key={transaction.id}><span>{transaction.counterparty || transaction.description || transaction.date}</span><strong>{money(transaction.amount, transaction.currency)}</strong></div>)}</div>
          <button className="button primary" type="submit" disabled={saving || !draft.value.trim() || !draft.categoryId || Boolean(filter.error)}><Save size={15} />{draft.id ? 'Save rule' : 'Add rule'}</button>
        </form>
      </section>
    </div>
    <section className="saved-rules"><div className="section-heading"><h2>Rules <span className="count">{filteredRules.length}</span></h2><span className="muted">Newest first / Manual assignments take priority</span></div>
      <div className="rules-toolbar"><label>Category<select aria-label="Filter rules by category" value={activeRuleCategory} onChange={(event) => { setRuleCategory(event.target.value); setRulePage(0) }}>{[<option key="all" value="all">All categories</option>, ...categorization.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)]}</select></label><label>Per page<select aria-label="Rules per page" value={rulesPerPage} onChange={(event) => { setRulesPerPage(Number(event.target.value)); setRulePage(0) }}>{[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></label></div>
      {visibleRules.map((rule) => <div className="saved-rule" key={rule.id}><span className="rule-category-dot" style={{ background: categorization.categories.find((category) => category.id === rule.categoryId)?.color }} /><div><strong className={rule.matchType === 'regex' ? 'regex-input' : ''}>{rule.value}</strong><small>{fieldNames[rule.field]} / {rule.matchType === 'regex' ? 'Regex' : rule.field === 'counterAccount' ? 'Equals' : 'Contains'} / {directionNames[rule.direction]} / {categorization.categories.find((category) => category.id === rule.categoryId)?.name}</small></div><button className="icon-button" title={`Edit rule ${rule.value}`} aria-label={`Edit rule ${rule.value}`} disabled={saving} onClick={() => setRuleDraft(rule)}><Pencil size={16} /></button><DeleteButton title={`Delete rule ${rule.value}`} disabled={saving} onDelete={async () => { const success = await onChange({ action: 'deleteRule', id: rule.id }); if (success && draft.id === rule.id) resetRule(); return success }} /></div>)}
      {!filteredRules.length && <div className="empty-small">{categorization.rules.length ? 'No rules in this category.' : 'No rules yet.'}</div>}
      <div className="pagination rules-pagination"><span>{filteredRules.length ? `${currentRulePage * rulesPerPage + 1}-${Math.min((currentRulePage + 1) * rulesPerPage, filteredRules.length)} of ${filteredRules.length.toLocaleString()} rules` : '0 rules'}</span><div><button type="button" className="icon-button" title="Previous rules page" aria-label="Previous rules page" disabled={!currentRulePage} onClick={() => setRulePage(currentRulePage - 1)}><ChevronLeft size={17} /></button><span>Page {currentRulePage + 1} of {rulePageCount}</span><button type="button" className="icon-button" title="Next rules page" aria-label="Next rules page" disabled={currentRulePage >= rulePageCount - 1} onClick={() => setRulePage(currentRulePage + 1)}><ChevronRight size={17} /></button></div></div>
    </section>
  </>
}