import { useState, useEffect } from 'react'
import { getProducts, createProduct, updateProduct, deleteProduct } from '../../services/adminApi'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, SUCCESS, SUCCESS_BG, ERROR, ERROR_BG,
  DANGER, ADD_GREEN_BG,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

const emptyForm = { type_key: '', product_type: 'panel', name: '', part_number: '', length_cm: '', width_cm: '', kw_peak: '', active: true }

function EditRow({ product, onSave, onCancel, t }) {
  const [form, setForm] = useState({
    ...emptyForm, ...product,
    length_cm: product?.length_cm ?? '',
    width_cm:  product?.width_cm  ?? '',
    kw_peak:   product?.kw_peak   ?? '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const handleSave = () => {
    if (!form.name.trim() || !form.type_key.trim()) return
    if (!form.length_cm || !form.width_cm || !form.kw_peak) return
    onSave({
      ...form,
      length_cm: Number(form.length_cm),
      width_cm:  Number(form.width_cm),
      kw_peak:   Number(form.kw_peak),
    })
  }
  const inp = (key, placeholder, style = {}) => (
    <input value={form[key] ?? ''} onChange={e => set(key, e.target.value)} placeholder={placeholder}
      style={{ padding: '0.3rem 0.5rem', borderRadius: '5px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem', width: '100%', ...style }} />
  )
  return (
    <tr style={{ background: ADD_GREEN_BG }}>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('type_key', 'e.g. aiko-g670', { fontFamily: 'monospace' })}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('name', 'e.g. AIKO G670')}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('part_number', 'P.N.')}</td>
      <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right' }}>{inp('length_cm', '238.2', { width: '5rem', textAlign: 'right' })}</td>
      <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right' }}>{inp('width_cm',  '113.4', { width: '5rem', textAlign: 'right' })}</td>
      <td style={{ padding: '0.4rem 0.75rem', textAlign: 'right' }}>{inp('kw_peak',   '670',   { width: '4.5rem', textAlign: 'right' })}</td>
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

export default function PanelTypesTab() {
  const { t } = useLang()
  const [panels, setPanels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [addingNew, setAddingNew] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    getProducts('panel')
      .then(data => { setPanels(data); setLoading(false) })
      .catch(() => { setError(t('admin.panels.failedLoad')); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCreate = async (form) => {
    try {
      const created = await createProduct({ ...form, product_type: 'panel' })
      setPanels(prev => [...prev, created])
      setAddingNew(false)
    } catch { setError(t('admin.panels.failedCreate')) }
  }

  const handleUpdate = async (id, form) => {
    try {
      const updated = await updateProduct(id, form)
      setPanels(prev => prev.map(p => p.id === id ? updated : p))
      setEditingId(null)
    } catch { setError(t('admin.panels.failedUpdate')) }
  }

  const handleDelete = async (id) => {
    if (!window.confirm(t('admin.panels.deleteConfirm'))) return
    try {
      await deleteProduct(id)
      setPanels(prev => prev.filter(p => p.id !== id))
    } catch { setError(t('admin.panels.failedDelete')) }
  }

  const handleToggleActive = async (p) => {
    try {
      const updated = await updateProduct(p.id, { active: !p.active })
      setPanels(prev => prev.map(x => x.id === p.id ? updated : x))
    } catch { setError(t('admin.common.failedUpdate')) }
  }

  const filtered = panels.filter(p =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.type_key.toLowerCase().includes(filter.toLowerCase())
  )

  const thStyle: React.CSSProperties = { padding: '0.55rem 0.75rem', fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', background: BG_SUBTLE, borderBottom: `1px solid ${BORDER_LIGHT}` }

  if (loading) return <div style={{ padding: '2rem', color: TEXT_LIGHT }}>{t('admin.common.loading')}</div>

  return (
    <div>
      {error && <div style={{ padding: '0.6rem 0.8rem', background: ERROR_BG, color: ERROR, borderRadius: '8px', marginBottom: '1rem', fontSize: '0.83rem' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <input
          value={filter} onChange={e => setFilter(e.target.value)}
          placeholder={t('admin.panels.filterPlaceholder')}
          style={{ padding: '0.4rem 0.7rem', borderRadius: '7px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.85rem', width: '240px', outline: 'none' }}
        />
        <button
          onClick={() => { setAddingNew(true); setEditingId(null) }}
          disabled={addingNew}
          style={{ padding: '0.4rem 0.9rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: '7px', fontWeight: '700', fontSize: '0.83rem', cursor: 'pointer' }}
        >
          {t('admin.panels.addPanel')}
        </button>
      </div>

      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '480px', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem', whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <th style={thStyle}>{t('admin.panels.col.key')}</th>
              <th style={thStyle}>{t('admin.panels.col.name')}</th>
              <th style={thStyle}>{t('admin.panels.col.pn')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('admin.panels.col.lengthCm')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('admin.panels.col.widthCm')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('admin.panels.col.wp')}</th>
              <th style={thStyle}>{t('admin.panels.col.status')}</th>
              <th style={thStyle}>{t('admin.common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {addingNew && (
              <EditRow product={null} onSave={handleCreate} onCancel={() => setAddingNew(false)} t={t} />
            )}
            {filtered.length === 0 && !addingNew && (
              <tr>
                <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: TEXT_LIGHT, fontSize: '0.83rem' }}>
                  {t('admin.panels.empty')}
                </td>
              </tr>
            )}
            {filtered.map((p, i) => (
              editingId === p.id ? (
                <EditRow key={p.id} product={p} onSave={(form) => handleUpdate(p.id, form)} onCancel={() => setEditingId(null)} t={t} />
              ) : (
                <tr key={p.id} style={{ background: i % 2 === 0 ? 'white' : BG_SUBTLE, borderTop: `1px solid ${BORDER_FAINT}` }}>
                  <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: TEXT_SECONDARY }}>{p.type_key}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, fontWeight: '500' }}>{p.name}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_LIGHT }}>{p.part_number || '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, fontWeight: '600', textAlign: 'right' }}>{p.length_cm ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, fontWeight: '600', textAlign: 'right' }}>{p.width_cm ?? '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, fontWeight: '600', textAlign: 'right' }}>{p.kw_peak != null ? `${p.kw_peak} W` : '—'}</td>
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
      <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: TEXT_VERY_LIGHT }}>{t('admin.panels.count', { count: filtered.length })}</div>
    </div>
  )
}
