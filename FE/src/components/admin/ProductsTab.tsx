import { useState, useEffect } from 'react'
import { getProducts, createProduct, updateProduct, deleteProduct } from '../../services/adminApi'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, SUCCESS, SUCCESS_BG, ERROR, ERROR_BG,
  DANGER, ADD_GREEN_BG,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

// Material categories the BOM uses (kept in sync with BE migration 0036).
// 'material' is the legacy catch-all and stays first in the list as the default.
const MATERIAL_CATEGORIES = [
  'material',
  'aluminium',
  'screws',
  'clamps',
  'accessories',
  'anchoring',
  'electrical_cabinets',
  'electrical_wiring',
  'panel_cable_extensions',
]

const emptyForm = {
  type_key: '', product_type: 'material', part_number: '', name: '', name_he: '',
  additional_info: '', active: true, extra: '', alt_group: '', is_default: false,
  price_ils: '', weight_kg: '', depreciation_pct: '', process_pct: '',
}

function EditRow({ product, onSave, onCancel, t }) {
  const initial = product
    ? {
        ...emptyForm, ...product,
        alt_group:        product.alt_group ?? '',
        price_ils:        product.price_ils ?? '',
        weight_kg:        product.weight_kg ?? '',
        depreciation_pct: product.depreciation_pct ?? '',
        process_pct:      product.process_pct ?? '',
      }
    : { ...emptyForm }
  const [form, setForm] = useState(initial)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const numOrNull = (v) => v === '' || v === null ? null : Number(v)
  const handleSave = () => {
    if (!form.name.trim() || !form.type_key.trim()) return
    onSave({
      ...form,
      alt_group:        form.alt_group === '' ? null : Number(form.alt_group),
      price_ils:        numOrNull(form.price_ils),
      weight_kg:        numOrNull(form.weight_kg),
      depreciation_pct: numOrNull(form.depreciation_pct),
      process_pct:      numOrNull(form.process_pct),
    })
  }
  const inp = (key, placeholder, style = {}, type = 'text') => (
    <input type={type} value={form[key] ?? ''} onChange={e => set(key, e.target.value)} placeholder={placeholder}
      style={{ padding: '0.3rem 0.5rem', borderRadius: '5px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem', width: '100%', ...style }} />
  )
  return (
    <tr style={{ background: ADD_GREEN_BG }}>
      <td style={{ padding: '0.4rem 0.5rem' }}>
        {product
          ? <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: TEXT_SECONDARY }}>{form.type_key}</span>
          : inp('type_key', 'type_key', { fontFamily: 'monospace' })
        }
      </td>
      <td style={{ padding: '0.4rem 0.3rem', textAlign: 'center', color: TEXT_LIGHT, fontSize: '0.75rem' }}>
        {form.bundle?.multiplier != null ? `×${form.bundle.multiplier}` : ''}
      </td>
      <td style={{ padding: '0.4rem 0.5rem' }}>
        <select value={form.product_type} onChange={e => set('product_type', e.target.value)}
          style={{ padding: '0.3rem', borderRadius: '5px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem', width: '100%' }}>
          {MATERIAL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          {/* Allow keeping a non-standard category that came from the DB. */}
          {form.product_type && !MATERIAL_CATEGORIES.includes(form.product_type) && form.product_type !== 'panel' && (
            <option value={form.product_type}>{form.product_type}</option>
          )}
        </select>
      </td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('name', t('admin.products.placeholderName'))}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('name_he', t('admin.products.placeholderNameHe'), { direction: 'rtl' })}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('part_number', t('admin.products.col.pn'))}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('price_ils', '₪',           { textAlign: 'right' }, 'number')}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('weight_kg', 'kg',          { textAlign: 'right' }, 'number')}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('depreciation_pct', '%',    { textAlign: 'right' }, 'number')}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('process_pct',      '%',    { textAlign: 'right' }, 'number')}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('extra', 'e.g. 10%')}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('alt_group', '#', { width: '3.5rem' })}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>
        <input type="checkbox" checked={!!form.is_default} onChange={e => set('is_default', e.target.checked)} />
      </td>
      <td style={{ padding: '0.4rem 0.5rem' }}>
        <select value={String(form.active)} onChange={e => set('active', e.target.value === 'true')}
          style={{ padding: '0.3rem', borderRadius: '5px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem' }}>
          <option value="true">{t('admin.common.active')}</option>
          <option value="false">{t('admin.common.inactive')}</option>
        </select>
      </td>
      <td style={{ padding: '0.4rem 0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <button onClick={handleSave} title={t('admin.common.save')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: SUCCESS, padding: '0.3rem', display: 'inline-flex', alignItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          </button>
          <button onClick={onCancel} title={t('admin.common.cancel')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: TEXT_VERY_LIGHT, padding: '0.3rem', display: 'inline-flex', alignItems: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
      </td>
    </tr>
  )
}

export default function ProductsTab() {
  const { t } = useLang()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [addingNew, setAddingNew] = useState(false)
  const [filter, setFilter] = useState('')
  const [filterActive, setFilterActive] = useState('all')
  const [sortCols, setSortCols] = useState([{ key: 'active', dir: 'asc' }, { key: 'type_key', dir: 'asc' }])

  useEffect(() => {
    getProducts('material')
      .then(data => { setProducts(data); setLoading(false) })
      .catch(() => { setError(t('admin.products.failedLoad')); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCreate = async (form) => {
    try {
      const created = await createProduct({ ...form, product_type: form.product_type || 'material' })
      setProducts(prev => [...prev, created])
      setAddingNew(false)
    } catch { setError(t('admin.products.failedCreate')) }
  }

  const handleUpdate = async (id, form) => {
    try {
      const updated = await updateProduct(id, form)
      setProducts(prev => prev.map(p => p.id === id ? updated : p))
      setEditingId(null)
    } catch { setError(t('admin.products.failedUpdate')) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm(t('admin.products.deleteConfirm'))) return
    try {
      await deleteProduct(id)
      setProducts(prev => prev.filter(p => p.id !== id))
    } catch { setError(t('admin.products.failedDelete')) }
  }

  const handleToggleActive = async (p) => {
    try {
      const updated = await updateProduct(p.id, { active: !p.active })
      setProducts(prev => prev.map(x => x.id === p.id ? updated : x))
    } catch { setError(t('admin.common.failedUpdate')) }
  }

  function handleSortClick(key, e) {
    if (e.shiftKey) {
      setSortCols(prev => {
        const idx = prev.findIndex(c => c.key === key)
        if (idx === -1) return [...prev, { key, dir: 'asc' }]
        if (prev[idx].dir === 'asc') return prev.map((c, i) => i === idx ? { ...c, dir: 'desc' } : c)
        return prev.filter((_, i) => i !== idx)
      })
    } else {
      setSortCols(prev => {
        const existing = prev.find(c => c.key === key)
        if (existing && prev.length === 1) return [{ key, dir: existing.dir === 'asc' ? 'desc' : 'asc' }]
        return [{ key, dir: 'asc' }]
      })
    }
  }

  function sortVal(p, key) {
    switch (key) {
      case 'type_key':         return p.type_key ?? ''
      case 'product_type':     return p.product_type ?? ''
      case 'name':             return p.name ?? ''
      case 'name_he':          return p.name_he ?? ''
      case 'part_number':      return p.part_number ?? ''
      case 'price_ils':        return p.price_ils ?? Infinity
      case 'weight_kg':        return p.weight_kg ?? Infinity
      case 'depreciation_pct': return p.depreciation_pct ?? Infinity
      case 'process_pct':      return p.process_pct ?? Infinity
      case 'extra':            return p.extra ?? ''
      case 'alt_group':        return p.alt_group ?? Infinity
      case 'multiplier':       return p.bundle?.multiplier ?? Infinity
      case 'is_default':       return p.is_default ? 0 : 1
      case 'active':           return p.active ? 0 : 1
      default:                 return ''
    }
  }

  const filtered = (() => {
    const sorted = products
      .filter(p =>
        (filterActive === 'all' || (filterActive === 'active' ? p.active : !p.active)) &&
        (!filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.type_key.toLowerCase().includes(filter.toLowerCase()))
      )
      .sort((a, b) => {
        for (const { key, dir } of sortCols) {
          const av = sortVal(a, key), bv = sortVal(b, key)
          const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv
          if (cmp !== 0) return dir === 'asc' ? cmp : -cmp
        }
        return 0
      })

    // Thread bundle children right under their parent (parent's `type_key`
    // matches the child's `bundle.parentType`). Children that fall out of
    // the current filter — or whose parent is filtered out — keep their
    // natural position, so the user always sees them somewhere.
    const childrenByParent = new Map()
    const top = []
    for (const p of sorted) {
      const parentType = p.bundle?.parentType
      if (parentType) {
        if (!childrenByParent.has(parentType)) childrenByParent.set(parentType, [])
        childrenByParent.get(parentType).push(p)
      } else {
        top.push(p)
      }
    }
    const threaded = []
    const consumed = new Set()
    for (const p of top) {
      threaded.push(p)
      const ch = childrenByParent.get(p.type_key)
      if (ch) { threaded.push(...ch); consumed.add(p.type_key) }
    }
    for (const [k, ch] of childrenByParent) {
      if (!consumed.has(k)) threaded.push(...ch)
    }
    return threaded
  })()

  const thStyle: React.CSSProperties = { padding: '0.55rem 0.75rem', fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', background: BG_SUBTLE, borderBottom: `1px solid ${BORDER_LIGHT}`, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }

  function SortTh({ colKey, label, style = {} }) {
    const idx = sortCols.findIndex(c => c.key === colKey)
    const col = sortCols[idx]
    return (
      <th onClick={e => handleSortClick(colKey, e)} title={t('admin.products.sortTooltip')} style={{ ...thStyle, ...style, color: col ? PRIMARY : TEXT_VERY_LIGHT }}>
        {label}
        {col && <span style={{ marginLeft: '4px', fontSize: '0.6rem' }}>{col.dir === 'asc' ? '▲' : '▼'}</span>}
        {col && sortCols.length > 1 && <span style={{ marginLeft: '2px', fontSize: '0.55rem', opacity: 0.7 }}>{idx + 1}</span>}
      </th>
    )
  }

  if (loading) return <div style={{ padding: '2rem', color: TEXT_LIGHT }}>{t('admin.common.loading')}</div>

  return (
    <div>
      {error && <div style={{ padding: '0.6rem 0.8rem', background: ERROR_BG, color: ERROR, borderRadius: '8px', marginBottom: '1rem', fontSize: '0.83rem' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.6rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <input
            value={filter} onChange={e => setFilter(e.target.value)}
            placeholder={t('admin.products.filterPlaceholder')}
            style={{ padding: '0.4rem 0.7rem', borderRadius: '7px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.85rem', width: '220px', outline: 'none' }}
          />
          <select value={filterActive} onChange={e => setFilterActive(e.target.value)}
            style={{ padding: '0.4rem 0.6rem', borderRadius: '7px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.85rem', outline: 'none' }}>
            <option value="all">{t('admin.common.all')}</option>
            <option value="active">{t('admin.common.activeOnly')}</option>
            <option value="inactive">{t('admin.common.inactiveOnly')}</option>
          </select>
        </div>
        <button
          onClick={() => { setAddingNew(true); setEditingId(null) }}
          disabled={addingNew}
          style={{ padding: '0.4rem 0.9rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: '7px', fontWeight: '700', fontSize: '0.83rem', cursor: 'pointer' }}
        >
          {t('admin.products.addMaterial')}
        </button>
      </div>

      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '480px', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem', whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <SortTh colKey="type_key"         label={t('admin.products.col.key')} />
              <SortTh colKey="multiplier"       label="×" style={{ width: '1px', textAlign: 'center' }} />
              <SortTh colKey="product_type"     label={t('admin.products.col.category')} />
              <SortTh colKey="name"             label={t('admin.products.col.name')} />
              <SortTh colKey="name_he"          label={t('admin.products.col.nameHe')} style={{ textAlign: 'right' }} />
              <SortTh colKey="part_number"      label={t('admin.products.col.pn')} />
              <SortTh colKey="price_ils"        label={t('admin.products.col.priceIls')} style={{ textAlign: 'right' }} />
              <SortTh colKey="weight_kg"        label={t('admin.products.col.weightKg')} style={{ textAlign: 'right' }} />
              <SortTh colKey="depreciation_pct" label={t('admin.products.col.depPct')} style={{ textAlign: 'right' }} />
              <SortTh colKey="process_pct"      label={t('admin.products.col.procPct')} style={{ textAlign: 'right' }} />
              <SortTh colKey="extra"            label={t('admin.products.col.extra')} />
              <SortTh colKey="alt_group"        label={t('admin.products.col.altGroup')} style={{ textAlign: 'center' }} />
              <SortTh colKey="is_default"       label={t('admin.products.col.default')} style={{ textAlign: 'center' }} />
              <SortTh colKey="active"           label={t('admin.products.col.status')} />
              <th style={thStyle}>{t('admin.common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {addingNew && (
              <EditRow product={null} onSave={handleCreate} onCancel={() => setAddingNew(false)} t={t} />
            )}
            {filtered.length === 0 && !addingNew && (
              <tr>
                <td colSpan={15} style={{ padding: '2rem', textAlign: 'center', color: TEXT_LIGHT, fontSize: '0.83rem' }}>
                  {t('admin.products.empty')}
                </td>
              </tr>
            )}
            {filtered.map((p, i) => (
              editingId === p.id ? (
                <EditRow key={p.id} product={p} onSave={(form) => handleUpdate(p.id, form)} onCancel={() => setEditingId(null)} t={t} />
              ) : (
                <tr key={p.id} style={{ background: i % 2 === 0 ? 'white' : BG_SUBTLE, borderTop: `1px solid ${BORDER_FAINT}` }}>
                  <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: TEXT_SECONDARY, maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: p.bundle?.parentType ? '2rem' : '0.75rem' }}>
                    {p.bundle?.parentType && <span style={{ color: TEXT_VERY_LIGHT, marginRight: '0.3rem' }}>└─</span>}
                    {p.type_key}
                  </td>
                  <td style={{ padding: '0.45rem 0.3rem', textAlign: 'center', color: TEXT_LIGHT, fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {p.bundle?.multiplier != null ? `×${p.bundle.multiplier}` : ''}
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_LIGHT, fontFamily: 'monospace', fontSize: '0.75rem' }}>{p.product_type}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, fontWeight: '500' }}>{p.name}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_SECONDARY, direction: 'rtl' }}>{p.name_he || '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_LIGHT }}>{p.part_number || '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_LIGHT, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.price_ils ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_LIGHT, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.weight_kg ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_LIGHT, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.depreciation_pct ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_LIGHT, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.process_pct ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_LIGHT, fontSize: '0.78rem' }}>{p.extra || '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_LIGHT, textAlign: 'center' }}>{p.alt_group ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', textAlign: 'center', color: p.is_default ? SUCCESS : TEXT_VERY_LIGHT }}>{p.is_default ? '✓' : '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem' }}>
                    <button onClick={() => handleToggleActive(p)} style={{
                      padding: '0.2rem 0.55rem', borderRadius: '12px', fontSize: '0.72rem', fontWeight: '700', border: 'none', cursor: 'pointer',
                      background: p.active ? SUCCESS_BG : BORDER_FAINT,
                      color: p.active ? SUCCESS : TEXT_VERY_LIGHT,
                    }}>
                      {p.active ? t('admin.common.active') : t('admin.common.inactive')}
                    </button>
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      <button onClick={() => { setEditingId(p.id); setAddingNew(false) }} title={t('admin.common.edit')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: TEXT_SECONDARY, padding: '0.3rem', display: 'inline-flex', alignItems: 'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button onClick={() => handleDelete(p.id)} title={t('admin.common.delete')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: DANGER, padding: '0.3rem', display: 'inline-flex', alignItems: 'center' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: TEXT_VERY_LIGHT }}>{t('admin.products.count', { count: filtered.length })}</div>
    </div>
  )
}
