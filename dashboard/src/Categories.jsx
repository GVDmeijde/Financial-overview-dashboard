import { localizeError, useLocale } from './localization.js'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, Pencil, Plus, Save, Tags, Trash2, X } from 'lucide-react'
import { categorySpendingByInterval, compileFilter, matchesRule, merchantIdentity, merchantSummary } from './categories.js'
import { formatChartPeriod } from './finance.js'

const spendingColors = ['#087f70', '#4285d4', '#bd7b12', '#bb5274', '#7476b9', '#519ea3', '#a46c54', '#7f9154']

function SpendingPie({ groups, money, onSelect, label }) {
  const { t, locale } = useLocale()
  const slices = groups.filter((group) => group.outgoing > 0).map((group, index) => ({ ...group, fill: group.color || spendingColors[index % spendingColors.length] }))
  const total = slices.reduce((sum, group) => sum + group.outgoing, 0)
  if (!total) return <div className="spending-pie empty-small">{t("No spending in this period.")}</div>
  return <div className="spending-pie" role="group" aria-label={label}>
    <ResponsiveContainer width="100%" height="100%" minWidth={0}><PieChart accessibilityLayer>
      <Pie data={slices} dataKey="outgoing" nameKey="name" cx="50%" cy="50%" innerRadius={76} outerRadius={108} paddingAngle={slices.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false} onClick={(entry) => onSelect(entry.payload?.id ?? entry.id)} />
      <Tooltip content={({ active, payload }) => active && payload?.length ? <div className="chart-tooltip"><strong>{payload[0].name}</strong><div><b>{money(payload[0].value)}</b><span>{(payload[0].value / total * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span></div></div> : null} />
    </PieChart></ResponsiveContainer>
    <div className="pie-total"><small>{t("Total spent")}</small><strong>{money(total)}</strong></div>
  </div>
}

export function CategorySpendingChart({ transactions, categorization, groups, money, formatAxis, interval = 'month', start, end }) {
  const { t, locale } = useLocale()
  const buckets = categorySpendingByInterval(transactions, categorization, interval, start, end)
  const series = groups.filter((category) => category.outgoing > 0)
  const intervalLabel = { day: t("Daily"), week: t("Weekly"), month: t("Monthly") }[interval]
  return <section className="monthly-category-section" aria-label={t({ day: 'Daily spending by category', week: 'Weekly spending by category', month: 'Monthly spending by category' }[interval])}>
    <div className="section-heading"><div><h2>{t({ day: 'Daily spending by category', week: 'Weekly spending by category', month: 'Monthly spending by category' }[interval])}</h2><p className="section-subtitle">{t("External debits / Selected accounts and period")}</p></div><span className="muted">{intervalLabel}</span></div>
    <div className="chart-legend">{series.map((category) => <span key={category.id}><i style={{ background: category.color }} />{category.name}</span>)}</div>
    <div className="monthly-category-chart">{buckets.length && series.length ? <ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <BarChart data={buckets} margin={{ top: 12, right: 8, left: 0, bottom: 4 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="#e7ece9" strokeDasharray="3 4" />
        <XAxis dataKey="period" tickFormatter={(value) => formatChartPeriod(value, interval, false, locale)} minTickGap={35} tickLine={false} axisLine={false} tickMargin={10} />
        <YAxis tickFormatter={formatAxis} width={60} tickLine={false} axisLine={false} />
        <Tooltip cursor={{ fill: '#e8eeea88' }} content={({ active, payload }) => {
          const point = payload?.[0]?.payload
          if (!active || !point) return null
          return <div className="chart-tooltip category-spending-tooltip"><strong>{formatChartPeriod(point.period, interval, true, locale)}</strong>{series.filter((category) => point.categories[category.id] > 0).map((category) => <div key={category.id}><span><i style={{ background: category.color }} />{category.name}</span><b>{money(point.categories[category.id])}</b></div>)}<div className="chart-tooltip-total"><span>{t("Total money out")}</span><b>{money(point.total)}</b></div></div>
        }} />
        {series.map((category) => <Bar key={category.id} dataKey={(point) => point.categories[category.id]} name={category.name} stackId="category-spending" fill={category.color} maxBarSize={42} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer> : <div className="empty-small">{t("No spending in this period.")}</div>}</div>
    <p className="flow-note">{t("Transfers between imported accounts excluded. Credits and refunds are separate from spending.")}</p>
  </section>
}

export function CategorySelect({ categorization, includeRules = false, ...props }) {
  const { t } = useLocale()
  return <select {...props}><option value="">{t("Uncategorized")}</option>{categorization.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}{includeRules && <option value="__rules__">{t("Use rules (clear override)")}</option>}</select>
}

export function CategoryBreakdown({ groups, money, onSelect, onManage, averageMonths = 1 }) {
  const { t, locale } = useLocale()
  const total = groups.reduce((sum, group) => sum + group.outgoing, 0)
  return <section className="category-breakdown">
    <div className="section-heading"><div><h2>{t("Spending by category")}</h2><p className="section-subtitle">{t("Gross debits / Selected accounts and period")}</p></div>{onManage ? <button className="text-button" onClick={onManage}><Tags size={14} />{t("Manage categories")}</button> : <strong className="category-total">{money(total)}</strong>}</div>
    <div className="category-spending-grid"><SpendingPie groups={groups} money={money} onSelect={onSelect} label={t("Category spending pie chart")} />
    <div className="category-summary">{groups.map((group) => <button className="category-summary-row" key={group.id} onClick={() => onSelect(group.id)}>
      <span className="category-summary-label"><i style={{ background: group.color }} /><span><strong>{group.name}</strong><small>{t('{{count}} transactions', { count: group.count })}</small></span></span>
      <span className="category-meter"><span style={{ width: `${total ? group.outgoing / total * 100 : 0}%`, background: group.color }} /></span>
      <span className="category-summary-amount"><strong>{money(group.outgoing)}</strong><small>{total ? (group.outgoing / total * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : (0).toLocaleString(locale, { minimumFractionDigits: 1 })}%</small><small className="monthly-average">{t('Avg {{amount}} / mo', { amount: money(averageMonths ? group.outgoing / averageMonths : null) })}</small></span><ArrowRight size={14} />
    </button>)}</div></div>
  </section>
}

export function CategoryDetail({ category, transactions, categorization, money, averageMonths = 1, onBack, onViewTransactions, renderTransactions }) {
  const { t, locale } = useLocale()
  const [merchantId, setMerchantId] = useState('all')
  const [page, setPage] = useState(0)
  const merchants = merchantSummary(transactions, categorization, category.id).map((merchant, index) => ({ ...merchant, name: merchant.id === 'unknown' ? t('Unknown counterparty') : merchant.name, color: spendingColors[index % spendingColors.length] }))
  const selectedMerchant = merchants.find((merchant) => merchant.id === merchantId)
  const selectedId = selectedMerchant ? merchantId : 'all'
  const rows = transactions.filter((transaction) => selectedId === 'all' || merchantIdentity(transaction).id === selectedId)
  const pageCount = Math.max(1, Math.ceil(rows.length / 20))
  const currentPage = Math.min(page, pageCount - 1)
  const selectMerchant = (id) => { setMerchantId(id); setPage(0) }
  return <div className="category-detail">
    <div className="category-detail-actions"><button className="text-button" onClick={onBack}><ArrowLeft size={15} />{t("All categories")}</button><button className="text-button" onClick={onViewTransactions}>{t("Open in transactions")}<ArrowRight size={14} /></button></div>
    <section className="metrics" aria-label={t("Category summary")}>
      <article className="metric"><div className="metric-label">{t("Total spent")}</div><strong className="metric-value">{money(category.outgoing)}</strong><small>{t("Gross debits in selected period")}</small></article>
      <article className="metric"><div className="metric-label">{t("Money returned / Credits")}</div><strong className="metric-value positive">{money(category.incoming)}</strong><small>{t("Credits are separate from spending")}</small></article>
      <article className="metric"><div className="metric-label">{t("Transactions")}</div><strong className="metric-value">{category.count.toLocaleString(locale)}</strong><small>{t("All payments and credits")}</small></article>
      <article className="metric"><div className="metric-label">{t("Monthly average")}</div><strong className="metric-value">{money(averageMonths ? category.outgoing / averageMonths : null)}</strong><small>{t("Average external spending / month")}</small></article>
    </section>
    <section className="category-merchant-section"><div className="section-heading"><div><h2>{t("Where the money goes")}</h2><p className="section-subtitle">{category.name} / {t('Gross debits by counterparty')}</p></div><span className="muted">{t('{{count}} groups', { count: merchants.length })}</span></div>
      <div className="category-spending-grid"><SpendingPie groups={merchants} money={money} onSelect={selectMerchant} label={t("Merchant spending pie chart")} />
        <div className="merchant-list">{merchants.map((merchant) => <button className={`merchant-summary-row ${selectedId === merchant.id ? 'selected' : ''}`} aria-pressed={selectedId === merchant.id} key={merchant.id} onClick={() => selectMerchant(merchant.id)}>
          <i style={{ background: merchant.color }} /><span><strong>{merchant.name}</strong><small>{t('{{count}} transactions', { count: merchant.count })}{merchant.incoming ? ` / ${t('Credits {{amount}}', { amount: money(merchant.incoming) })}` : ''}</small></span><span className="category-summary-amount"><strong>{money(merchant.outgoing)}</strong><small>{category.outgoing ? (merchant.outgoing / category.outgoing * 100).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : (0).toLocaleString(locale, { minimumFractionDigits: 1 })}%</small><small className="monthly-average">{t('Avg {{amount}} / mo', { amount: money(averageMonths ? merchant.outgoing / averageMonths : null) })}</small></span><ChevronRight size={15} />
        </button>)}{!merchants.length && <div className="empty-small">{t("No transactions in this category for this period.")}</div>}</div>
      </div>
    </section>
    <section className="transactions-section category-detail-transactions"><div className="section-heading"><div><h2>{selectedMerchant?.name || t("All category transactions")}</h2><p className="section-subtitle">{t('{{count}} transactions', { count: rows.length })}</p></div><select aria-label={t("Filter merchant")} value={selectedId} onChange={(event) => selectMerchant(event.target.value)}><option value="all">{t("All counterparties")}</option>{merchants.map((merchant) => <option key={merchant.id} value={merchant.id}>{merchant.name}</option>)}</select></div>
      {renderTransactions(rows.slice(currentPage * 20, (currentPage + 1) * 20), true)}
      <div className="pagination"><span>{rows.length ? t('{{start}}-{{end}} of {{total}}', { start: (currentPage * 20 + 1).toLocaleString(locale), end: Math.min((currentPage + 1) * 20, rows.length).toLocaleString(locale), total: rows.length.toLocaleString(locale) }) : t('{{count}} transactions', { count: 0 })}</span><div><button className="icon-button" title={t("Previous category page")} aria-label={t("Previous category page")} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={17} /></button><span>{t('Page {{page}} of {{total}}', { page: currentPage + 1, total: pageCount })}</span><button className="icon-button" title={t("Next category page")} aria-label={t("Next category page")} disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}><ChevronRight size={17} /></button></div></div>
    </section>
  </div>
}

function DeleteButton({ title, disabled, onDelete }) {
  const { t } = useLocale()
  const [confirm, setConfirm] = useState(false)
  return confirm ? <span className="delete-confirmation"><span>{t("Delete?")}</span><button type="button" className="icon-button danger" title={t('Confirm {{title}}', { title })} aria-label={t('Confirm {{title}}', { title })} disabled={disabled} onClick={async () => { if (await onDelete()) setConfirm(false) }}><Check size={16} /></button><button type="button" className="icon-button" title={t("Cancel deletion")} aria-label={t("Cancel deletion")} disabled={disabled} onClick={() => setConfirm(false)}><X size={16} /></button></span> : <button type="button" className="icon-button" title={title} aria-label={title} disabled={disabled} onClick={() => setConfirm(true)}><Trash2 size={16} /></button>
}

function CategoryEditor({ category, saving, onChange }) {
  const { t } = useLocale()
  const [name, setName] = useState(category.name)
  const [color, setColor] = useState(category.color)
  const changed = name !== category.name || color !== category.color
  return <form className="category-editor" onSubmit={(event) => { event.preventDefault(); onChange({ action: 'saveCategory', category: { ...category, name, color } }) }}>
    <input type="color" aria-label={t('Color for {{name}}', { name: category.name })} value={color} disabled={saving} onChange={(event) => setColor(event.target.value)} />
    <input aria-label={t('Name for {{name}}', { name: category.name })} value={name} required maxLength={60} disabled={saving} onChange={(event) => setName(event.target.value)} />
    <button className="icon-button" type="submit" title={t('Save {{name}}', { name: category.name })} aria-label={t('Save {{name}}', { name: category.name })} disabled={saving || !changed}><Save size={16} /></button>
    <DeleteButton title={t('Delete {{name}} and its rules', { name: category.name })} disabled={saving} onDelete={() => onChange({ action: 'deleteCategory', id: category.id })} />
  </form>
}

export function Categories({ categorization, transactions, groups, money, averageMonths, saving, onChange, onSelect, ruleDraft, setRuleDraft }) {
  const { t, locale } = useLocale()
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
  const fieldNames = { counterparty: t("Counterparty"), description: t("Description"), counterAccount: t("Counterparty account") }
  const directionNames = { out: t("Money out"), in: t("Money in"), all: t("All transactions") }
  const resetRule = () => setRuleDraft({ field: 'counterparty', matchType: 'text', value: '', direction: 'out', categoryId: draft.categoryId })
  return <>
    <CategoryBreakdown groups={groups} money={money} averageMonths={averageMonths} onSelect={onSelect} />
    <div className="category-management">
      <section className="category-definitions"><div className="section-heading"><h2>{t("Categories")}<span className="count">{categorization.categories.length}</span></h2></div>
        <div className="category-editors">{categorization.categories.map((category) => <CategoryEditor key={`${category.id}:${category.name}:${category.color}`} category={category} saving={saving} onChange={onChange} />)}</div>
        <form className="new-category-form" onSubmit={async (event) => { event.preventDefault(); if (await onChange({ action: 'saveCategory', category: { name, color } })) setName('') }}>
          <label htmlFor="new-category-name">{t("New category")}</label><div><input type="color" aria-label={t("New category color")} value={color} disabled={saving} onChange={(event) => setColor(event.target.value)} /><input id="new-category-name" value={name} placeholder={t("Category name")} required maxLength={60} disabled={saving} onChange={(event) => setName(event.target.value)} /><button className="icon-button" type="submit" title={t("Add category")} aria-label={t("Add category")} disabled={saving || !name.trim()}><Plus size={19} /></button></div>
        </form>
      </section>
      <section className="category-rules"><div className="section-heading"><h2>{draft.id ? t("Edit rule") : t("New rule")}</h2>{draft.id && <button className="text-button" disabled={saving} onClick={resetRule}><X size={14} />{t("Cancel edit")}</button>}</div>
        <form className="rule-form" onSubmit={async (event) => { event.preventDefault(); if (await onChange({ action: 'saveRule', rule: draft })) { resetRule(); setRulePage(0) } }}>
          <div className="rule-fields"><label>{t("Match field")}<select value={draft.field} disabled={saving} onChange={(event) => setRuleDraft({ ...draft, field: event.target.value })}>{Object.entries(fieldNames).map(([value, label]) => <option value={value} key={value}>{label}{draft.matchType === 'regex' ? '' : value === 'counterAccount' ? t(" equals") : t(" contains")}</option>)}</select></label><label>{t("Direction")}<select value={draft.direction} disabled={saving} onChange={(event) => setRuleDraft({ ...draft, direction: event.target.value })}>{Object.entries(directionNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label></div>
          <label>{t("Match type")}<select aria-label={t("Rule match type")} value={draft.matchType || 'text'} disabled={saving} onChange={(event) => setRuleDraft({ ...draft, matchType: event.target.value })}><option value="text">{t("Plain text")}</option><option value="regex">{t("Regular expression (RE2)")}</option></select></label>
          <label>{draft.matchType === 'regex' ? t("Pattern (case-insensitive)") : t("Match text")}<input aria-label={t("Rule match text")} aria-invalid={Boolean(filter.error)} aria-describedby={filter.error ? 'rule-regex-error' : undefined} className={draft.matchType === 'regex' ? 'regex-input' : ''} value={draft.value} maxLength={200} required disabled={saving} onChange={(event) => setRuleDraft({ ...draft, value: event.target.value })} /></label>
          {filter.error && <p id="rule-regex-error" className="filter-error" role="alert">{localizeError(filter.error, t)}</p>}
          <label>{t("Assign category")}<select value={draft.categoryId} required disabled={saving || !categorization.categories.length} onChange={(event) => setRuleDraft({ ...draft, categoryId: event.target.value })}>{categorization.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <div className="rule-preview"><span>{t('{{count}} matches / All imported transactions', { count: matches.length })}</span>{matches.slice(-3).reverse().map((transaction) => <div key={transaction.id}><span>{transaction.counterparty || transaction.description || transaction.date}</span><strong>{money(transaction.amount, transaction.currency)}</strong></div>)}</div>
          <button className="button primary" type="submit" disabled={saving || !draft.value.trim() || !draft.categoryId || Boolean(filter.error)}><Save size={15} />{draft.id ? t("Save rule") : t("Add rule")}</button>
        </form>
      </section>
    </div>
    <section className="saved-rules"><div className="section-heading"><h2>{t("Rules")}<span className="count">{filteredRules.length}</span></h2><span className="muted">{t("Newest first / Manual assignments take priority")}</span></div>
      <div className="rules-toolbar"><label>{t("Category")}<select aria-label={t("Filter rules by category")} value={activeRuleCategory} onChange={(event) => { setRuleCategory(event.target.value); setRulePage(0) }}>{[<option key="all" value="all">{t("All categories")}</option>, ...categorization.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)]}</select></label><label>{t("Per page")}<select aria-label={t("Rules per page")} value={rulesPerPage} onChange={(event) => { setRulesPerPage(Number(event.target.value)); setRulePage(0) }}>{[10, 25, 50].map((size) => <option key={size} value={size}>{size}</option>)}</select></label></div>
      {visibleRules.map((rule) => <div className="saved-rule" key={rule.id}><span className="rule-category-dot" style={{ background: categorization.categories.find((category) => category.id === rule.categoryId)?.color }} /><div><strong className={rule.matchType === 'regex' ? 'regex-input' : ''}>{rule.value}</strong><small>{fieldNames[rule.field]} / {rule.matchType === 'regex' ? t("Regex") : rule.field === 'counterAccount' ? t("Equals") : t("Contains")} / {directionNames[rule.direction]} / {categorization.categories.find((category) => category.id === rule.categoryId)?.name}</small></div><button className="icon-button" title={t('Edit rule {{value}}', { value: rule.value })} aria-label={t('Edit rule {{value}}', { value: rule.value })} disabled={saving} onClick={() => setRuleDraft(rule)}><Pencil size={16} /></button><DeleteButton title={t('Delete rule {{value}}', { value: rule.value })} disabled={saving} onDelete={async () => { const success = await onChange({ action: 'deleteRule', id: rule.id }); if (success && draft.id === rule.id) resetRule(); return success }} /></div>)}
      {!filteredRules.length && <div className="empty-small">{categorization.rules.length ? t("No rules in this category.") : t("No rules yet.")}</div>}
      <div className="pagination rules-pagination"><span>{filteredRules.length ? t('{{start}}-{{end}} of {{total}} rules', { start: (currentRulePage * rulesPerPage + 1).toLocaleString(locale), end: Math.min((currentRulePage + 1) * rulesPerPage, filteredRules.length).toLocaleString(locale), total: filteredRules.length.toLocaleString(locale) }) : t('{{count}} rules', { count: 0 })}</span><div><button type="button" className="icon-button" title={t("Previous rules page")} aria-label={t("Previous rules page")} disabled={!currentRulePage} onClick={() => setRulePage(currentRulePage - 1)}><ChevronLeft size={17} /></button><span>{t('Page {{page}} of {{total}}', { page: currentRulePage + 1, total: rulePageCount })}</span><button type="button" className="icon-button" title={t("Next rules page")} aria-label={t("Next rules page")} disabled={currentRulePage >= rulePageCount - 1} onClick={() => setRulePage(currentRulePage + 1)}><ChevronRight size={17} /></button></div></div>
    </section>
  </>
}