import { useId, useState } from 'react'
import { Check, Plus, Save, Search, Tags, Trash2, X } from 'lucide-react'
import { useLocale } from './localization.js'
import { transactionTags } from './categories.js'

function CreateTag({ onChange, saving, transactionIds }) {
  const { t } = useLocale()
  const [name, setName] = useState('')
  const [failed, setFailed] = useState(false)
  return <form className="tag-create" onSubmit={async (event) => {
    event.preventDefault()
    const success = await onChange({ action: 'saveTag', tag: { name }, ...(transactionIds ? { transactionIds } : {}) })
    setFailed(!success)
    if (success) setName('')
  }}>
    <input aria-label={t('New tag name')} placeholder={t('New tag name')} maxLength={60} required value={name} disabled={saving} onChange={(event) => { setName(event.target.value); setFailed(false) }} />
    <button className="icon-button" type="submit" title={t('Create tag')} aria-label={t('Create tag')} disabled={saving || !name.trim()}><Plus size={17} /></button>
    {failed && <p className="filter-error" role="alert">{t('Unable to save tag. Check the name and try again.')}</p>}
  </form>
}

export function TransactionTagList({ transaction, categorization }) {
  const { t } = useLocale()
  const tags = transactionTags(transaction, categorization)
  return tags.length ? <span className="transaction-tags" aria-label={t('Tags')}>{tags.map((tag) => <span className="transaction-tag" key={tag.id}><Tags size={10} />{tag.name}</span>)}</span> : null
}

export function TransactionTagEditor({ transaction, categorization, saving, onChange }) {
  const { t } = useLocale()
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState('')
  const listId = useId()
  const assigned = categorization.transactionTags?.[transaction.id] || []
  const normalize = (value) => value.normalize('NFKC').trim().toLowerCase()
  const available = (categorization.tags || []).filter((tag) => !assigned.includes(tag.id))
  const matches = available.filter((tag) => normalize(tag.name).includes(normalize(query))).slice(0, 30)
  const selectedTag = available.find((tag) => normalize(tag.name) === normalize(query))

  async function changeTag(tagId, operation) {
    if (saving) return false
    setFailed(false)
    const success = await onChange({ action: 'tagTransactions', transactionIds: [transaction.id], tagId, operation })
    setFailed(!success)
    return success
  }

  return <fieldset className="transaction-tag-editor" disabled={saving}>
    <legend>{t('Tags')}</legend>
    <div className="transaction-tags">{transactionTags(transaction, categorization).map((tag) => <span className="transaction-tag" key={tag.id}>
      {tag.name}<button className="tag-remove" type="button" title={t('Remove tag {{name}}', { name: tag.name })} aria-label={t('Remove tag {{name}}', { name: tag.name })} onClick={() => changeTag(tag.id, 'remove')}><X size={14} /></button>
    </span>)}</div>
    <form className="tag-picker" onSubmit={async (event) => {
      event.preventDefault()
      if (selectedTag && await changeTag(selectedTag.id, 'add')) setQuery('')
    }}>
      <label className="tag-search"><Search size={15} /><input type="text" list={listId} autoComplete="off" aria-label={t('Search tags')} placeholder={t('Search tags...')} value={query} onChange={(event) => { setQuery(event.target.value); setFailed(false) }} /></label>
      <datalist id={listId}>{matches.map((tag) => <option value={tag.name} key={tag.id} />)}</datalist>
      <button className="icon-button" type="submit" title={t('Add tag')} aria-label={t('Add tag')} disabled={saving || !selectedTag}><Plus size={17} /></button>
      {query.trim() && !matches.length && <span className="muted tag-picker-empty">{t('No matching tags.')}</span>}
    </form>
    <CreateTag onChange={onChange} saving={saving} transactionIds={[transaction.id]} />
    {failed && <p className="filter-error" role="alert">{t('Unable to update tags. Rescan and try again.')}</p>}
  </fieldset>
}

function TagDefinition({ tag, saving, onChange }) {
  const { t } = useLocale()
  const [name, setName] = useState(tag.name)
  const [confirm, setConfirm] = useState(false)
  const [failed, setFailed] = useState(false)
  return <form className="tag-definition" onSubmit={async (event) => {
    event.preventDefault()
    setFailed(!await onChange({ action: 'saveTag', tag: { ...tag, name } }))
  }}>
    <input aria-label={t('Tag name for {{name}}', { name: tag.name })} maxLength={60} required value={name} disabled={saving} onChange={(event) => { setName(event.target.value); setFailed(false) }} />
    <button className="icon-button" type="submit" title={t('Save tag')} aria-label={t('Save tag')} disabled={saving || !name.trim() || name === tag.name}><Save size={16} /></button>
    {confirm ? <>
      <span className="muted">{t('Delete?')}</span>
      <button className="icon-button danger" type="button" title={t('Confirm tag deletion')} aria-label={t('Confirm tag deletion')} disabled={saving} onClick={async () => setFailed(!await onChange({ action: 'deleteTag', id: tag.id }))}><Check size={16} /></button>
      <button className="icon-button" type="button" title={t('Cancel deletion')} aria-label={t('Cancel deletion')} onClick={() => setConfirm(false)}><X size={16} /></button>
    </> : <button className="icon-button danger" type="button" title={t('Delete tag {{name}}', { name: tag.name })} aria-label={t('Delete tag {{name}}', { name: tag.name })} disabled={saving} onClick={() => setConfirm(true)}><Trash2 size={16} /></button>}
    {failed && <p className="filter-error" role="alert">{t('Unable to save tag. Check the name and try again.')}</p>}
  </form>
}

export function TagFilter({ categorization, selectedIds, mode, onFilterChange, onModeChange, children }) {
  const { t } = useLocale()
  const tags = categorization.tags || []
  return <section className="transaction-tag-tools" aria-label={t('Transaction tags')}>
    <div className="tag-tools-row">
      <details className="tag-filter">
        <summary><Tags size={14} />{t('Filter tags')}{selectedIds.length > 0 && <span className="count">{selectedIds.length}</span>}</summary>
        <fieldset className="tag-checkboxes"><legend className="sr-only">{t('Filter tags')}</legend>{tags.map((tag) => <label key={tag.id}>
          <input type="checkbox" checked={selectedIds.includes(tag.id)} onChange={(event) => onFilterChange(event.target.checked ? [...selectedIds, tag.id] : selectedIds.filter((id) => id !== tag.id))} /><span>{tag.name}</span>
        </label>)}{!tags.length && <span className="muted">{t('No tags yet.')}</span>}</fieldset>
      </details>
      <select aria-label={t('Tag match mode')} value={mode} onChange={(event) => onModeChange(event.target.value)}>
        <option value="any">{t('Any selected tag')}</option><option value="all">{t('All selected tags')}</option>
      </select>
      {selectedIds.length > 0 && <button className="icon-button" type="button" title={t('Clear tag filters')} aria-label={t('Clear tag filters')} onClick={() => onFilterChange([])}><X size={16} /></button>}
      {children}
    </div>
    {selectedIds.length > 0 && <div className="active-tag-filters">{tags.filter((tag) => selectedIds.includes(tag.id)).map((tag) => <span className="transaction-tag" key={tag.id}>{tag.name}<button className="tag-remove" type="button" title={t('Remove tag filter {{name}}', { name: tag.name })} aria-label={t('Remove tag filter {{name}}', { name: tag.name })} onClick={() => onFilterChange(selectedIds.filter((id) => id !== tag.id))}><X size={12} /></button></span>)}</div>}
  </section>
}

export function TransactionTagTools({ categorization, selectedIds, mode, onFilterChange, onModeChange, transactionIds, saving, onChange }) {
  const { t, locale } = useLocale()
  const [bulkTagId, setBulkTagId] = useState('')
  const [operation, setOperation] = useState('add')
  const tags = categorization.tags || []
  const activeTagId = tags.some((tag) => tag.id === bulkTagId) ? bulkTagId : ''
  return <TagFilter categorization={categorization} selectedIds={selectedIds} mode={mode} onFilterChange={onFilterChange} onModeChange={onModeChange}>
      <details className="tag-management"><summary><Plus size={14} />{t('Manage tags')}</summary>
        <form className="bulk-tag-form" onSubmit={(event) => { event.preventDefault(); onChange({ action: 'tagTransactions', tagId: activeTagId, operation, transactionIds }) }}>
          <select aria-label={t('Bulk tag')} value={activeTagId} disabled={saving || !tags.length} onChange={(event) => setBulkTagId(event.target.value)}><option value="">{t('Choose tag')}</option>{tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select>
          <select aria-label={t('Tag action')} value={operation} disabled={saving} onChange={(event) => setOperation(event.target.value)}><option value="add">{t('Add tag')}</option><option value="remove">{t('Remove tag')}</option></select>
          <button className="button" type="submit" disabled={saving || !activeTagId || !transactionIds.length || transactionIds.length > 10000}><Check size={14} />{t('Apply to filtered transactions')}<span className="count">{transactionIds.length.toLocaleString(locale)}</span></button>
        </form>
        <CreateTag onChange={onChange} saving={saving} />
        <div className="tag-definition-list">{tags.map((tag) => <TagDefinition key={`${tag.id}:${tag.name}`} tag={tag} saving={saving} onChange={onChange} />)}</div>
      </details>
  </TagFilter>
}