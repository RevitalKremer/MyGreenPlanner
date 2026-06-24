import { useState, useEffect } from 'react'
import { getProducts, createProduct, updateProduct, deleteProduct } from '../../services/adminApi'
import {
  PRIMARY, PRIMARY_DARK, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, BG_FAINT, ERROR, ERROR_BG, DANGER,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'
import KeyValueEditor from '../shared/KeyValueEditor'
import ParamsTable from '../shared/ParamsTable'
import RowActions from '../shared/RowActions'
import { cleanParams } from '../../config/productParams'

const SADOT_URL_KEYS = [{ key: 'en', label: 'EN' }, { key: 'he', label: 'HE' }]

// Sadot Energy product types this tab manages (mirrors BE SADOT_EQUIPMENT_TYPES).
const SADOT_TYPES = ['inverter', 'battery', 'battery_base', 'dongle', 'datalogger', 'cable', 'smart_meter', 'network_cabinet', 'portable_power_station', 'bms', 'backup_box', 'energy_management']

const emptyForm = { type_key: '', product_type: 'inverter', name: '', part_number: '', price_ils: '', sadot_url: null, active: true, params: {} }

function EquipmentEditor({ product, onSave, onCancel, t }) {
  const [form, setForm] = useState(() => ({
    ...emptyForm, ...product,
    price_ils: product?.price_ils ?? '',
    sadot_url: product?.sadot_url ?? null,
    part_number: product?.part_number ?? '',
    params: product?.params ?? {},
  }))
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!form.name.trim() || !form.type_key.trim()) return
    const params = cleanParams(form.params)
    onSave({
      type_key: form.type_key.trim(),
      product_type: form.product_type,
      name: form.name.trim(),
      part_number: form.part_number.trim() || null,
      price_ils: form.price_ils === '' ? null : Number(form.price_ils),
      sadot_url: form.sadot_url && Object.keys(form.sadot_url).length ? form.sadot_url : null,
      active: form.active,
      params: Object.keys(params).length ? params : null,
    })
  }

  const field = (label, key, placeholder = '', extra = {}) => (
    <div style={{ flex: 1, minWidth: 160 }}>
      <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: TEXT_VERY_LIGHT, marginBottom: 3 }}>{label}</label>
      <input value={form[key] ?? ''} onChange={e => set(key, e.target.value)} placeholder={placeholder}
        style={{ padding: '0.35rem 0.5rem', borderRadius: 5, border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.82rem', width: '100%', ...extra }} />
    </div>
  )

  return (
    <div style={{ background: BG_FAINT, border: `1px solid ${BORDER_LIGHT}`, borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
        {field(t('admin.sadot.col.key'), 'type_key', 'e.g. sadot_max_50ktl3_lv', { fontFamily: 'monospace' })}
        {field(t('admin.sadot.col.name'), 'name', 'MAX 50KTL3 LV')}
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: TEXT_VERY_LIGHT, marginBottom: 3 }}>{t('admin.sadot.col.type')}</label>
          <select value={form.product_type} onChange={e => set('product_type', e.target.value)}
            style={{ padding: '0.35rem 0.5rem', borderRadius: 5, border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.82rem', width: '100%' }}>
            {SADOT_TYPES.map(ty => <option key={ty} value={ty}>{ty}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
        {field(t('admin.sadot.col.pn'), 'part_number', 'P.N.')}
        {field(t('admin.sadot.col.price'), 'price_ils', '0', { textAlign: 'right' })}
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: TEXT_VERY_LIGHT, marginBottom: 3 }}>{t('admin.sadot.sadotUrl')}</label>
        <KeyValueEditor value={form.sadot_url} onChange={v => set('sadot_url', v)} allowedKeys={SADOT_URL_KEYS} placeholder="https://sadot-energy.co.il/…" />
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: TEXT_VERY_LIGHT, marginBottom: 3 }}>{t('admin.sadot.electricalJson')}</label>
        <ParamsTable value={form.params} onChange={v => set('params', v)} productType={form.product_type} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <label style={{ fontSize: '0.8rem', color: TEXT_SECONDARY, display: 'flex', alignItems: 'center', gap: 5 }}>
          <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} /> {t('admin.common.active')}
        </label>
        <div style={{ flex: 1 }} />
        <button onClick={onCancel} style={{ padding: '0.4rem 0.9rem', background: 'white', border: `1px solid ${BORDER_LIGHT}`, borderRadius: 6, fontSize: '0.82rem', cursor: 'pointer' }}>{t('admin.common.cancel')}</button>
        <button onClick={handleSave} style={{ padding: '0.4rem 1rem', background: PRIMARY_DARK, color: 'white', border: 'none', borderRadius: 6, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}>{t('admin.common.save')}</button>
      </div>
    </div>
  )
}

export default function SadotEquipmentTab() {
  const { t } = useLang()
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [addingNew, setAddingNew] = useState(false)
  const [filter, setFilter] = useState('')
  const [openParams, setOpenParams] = useState<string | null>(null)

  useEffect(() => {
    getProducts('sadot')
      .then(data => { setItems(data); setLoading(false) })
      .catch(() => { setError(t('admin.sadot.failedLoad')); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCreate = async (form) => {
    try {
      const created = await createProduct(form)
      setItems(prev => [...prev, created])
      setAddingNew(false)
    } catch { setError(t('admin.sadot.failedSave')) }
  }
  const handleUpdate = async (id, form) => {
    try {
      const updated = await updateProduct(id, form)
      setItems(prev => prev.map(p => p.id === id ? updated : p))
      setEditingId(null)
    } catch { setError(t('admin.sadot.failedSave')) }
  }
  const handleDelete = async (id) => {
    if (!window.confirm(t('admin.sadot.deleteConfirm'))) return
    try { await deleteProduct(id); setItems(prev => prev.filter(p => p.id !== id)) }
    catch { setError(t('admin.sadot.failedSave')) }
  }

  const filtered = items.filter(p => !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.type_key.toLowerCase().includes(filter.toLowerCase()))
  const thStyle: React.CSSProperties = { padding: '0.55rem 0.75rem', fontSize: '0.72rem', fontWeight: 700, color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', background: BG_SUBTLE, borderBottom: `1px solid ${BORDER_LIGHT}` }

  if (loading) return <div style={{ padding: '2rem', color: TEXT_LIGHT }}>{t('admin.common.loading')}</div>

  return (
    <div>
      {error && <div style={{ padding: '0.6rem 0.8rem', background: ERROR_BG, color: ERROR, borderRadius: 8, marginBottom: '1rem', fontSize: '0.83rem' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder={t('admin.sadot.filterPlaceholder')}
          style={{ padding: '0.4rem 0.7rem', borderRadius: 7, border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.85rem', width: 240, outline: 'none' }} />
        <button onClick={() => { setAddingNew(true); setEditingId(null) }} disabled={addingNew}
          style={{ padding: '0.4rem 0.9rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: 7, fontWeight: 700, fontSize: '0.83rem', cursor: 'pointer' }}>
          {t('admin.sadot.add')}
        </button>
      </div>

      {addingNew && <EquipmentEditor product={null} onSave={handleCreate} onCancel={() => setAddingNew(false)} t={t} />}

      <div style={{ overflowX: 'auto', border: `1px solid ${BORDER_LIGHT}`, borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
          <thead>
            <tr>
              <th style={thStyle}>{t('admin.sadot.col.name')}</th>
              <th style={thStyle}>{t('admin.sadot.col.type')}</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>{t('admin.sadot.col.price')}</th>
              <th style={thStyle}>{t('admin.sadot.col.specs')}</th>
              <th style={thStyle}>{t('admin.common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && !addingNew && (
              <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: TEXT_LIGHT }}>{t('admin.sadot.empty')}</td></tr>
            )}
            {filtered.map((p, i) => (
              editingId === p.id ? (
                <tr key={p.id}><td colSpan={5} style={{ padding: '0.5rem' }}>
                  <EquipmentEditor product={p} onSave={(form) => handleUpdate(p.id, form)} onCancel={() => setEditingId(null)} t={t} />
                </td></tr>
              ) : (
                <tr key={p.id} style={{ background: i % 2 === 0 ? 'white' : BG_SUBTLE, borderTop: `1px solid ${BORDER_FAINT}`, opacity: p.active ? 1 : 0.55 }}>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, fontWeight: 500 }}>
                    {p.name}
                    {(p.sadot_url?.en || p.sadot_url?.he) && (
                      <a href={p.sadot_url.en || p.sadot_url.he} target="_blank" rel="noreferrer" style={{ marginInlineStart: 6, fontSize: '0.72rem' }}>↗</a>
                    )}
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_SECONDARY, fontFamily: 'monospace', fontSize: '0.76rem' }}>{p.product_type}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, textAlign: 'right' }}>{p.price_ils != null ? Number(p.price_ils).toLocaleString() : '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', position: 'relative' }}>
                    {p.params && Object.keys(p.params).length ? (
                      <>
                        <button onClick={() => setOpenParams(openParams === p.id ? null : p.id)}
                          title={t('admin.sadot.viewParams')}
                          style={{ background: 'none', border: `1px solid ${BORDER_LIGHT}`, borderRadius: 5, cursor: 'pointer', color: TEXT_SECONDARY, padding: '0.1rem 0.5rem', fontWeight: 700, lineHeight: 1 }}>…</button>
                        {openParams === p.id && (
                          <div style={{ position: 'absolute', zIndex: 20, top: '100%', insetInlineStart: '0.75rem', marginTop: 4, background: 'white', border: `1px solid ${BORDER_LIGHT}`, borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.14)', padding: '0.5rem 0.7rem', minWidth: 180, maxWidth: 320 }}>
                            {Object.entries(p.params).map(([k, v]) => (
                              <div key={k} style={{ fontSize: '0.76rem', color: TEXT_DARKEST, padding: '0.1rem 0', whiteSpace: 'nowrap' }}>
                                <span style={{ fontWeight: 700, fontFamily: 'monospace' }}>{k}</span>
                                <span style={{ color: TEXT_SECONDARY }}>: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : <span style={{ color: TEXT_VERY_LIGHT }}>—</span>}
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem' }}>
                    <RowActions
                      onEdit={() => { setEditingId(p.id); setAddingNew(false) }}
                      onDelete={() => handleDelete(p.id)}
                      editTitle={t('admin.common.edit')} deleteTitle={t('admin.common.delete')} />
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: TEXT_VERY_LIGHT }}>{t('admin.sadot.count', { count: filtered.length })}</div>
    </div>
  )
}
