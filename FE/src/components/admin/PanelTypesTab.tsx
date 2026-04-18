import { useState, useEffect } from 'react'
import { getProducts, createProduct, updateProduct, deleteProduct } from '../../services/adminApi'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, SUCCESS, SUCCESS_BG, ERROR, ERROR_BG,
  DANGER, ADD_GREEN_BG,
} from '../../styles/colors'

const emptyForm = { type_key: '', product_type: 'panel', name: '', part_number: '', length_cm: '', width_cm: '', kw_peak: '', active: true }

function EditRow({ product, onSave, onCancel }) {
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
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('length_cm', '238.2', { width: '5rem' })}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('width_cm',  '113.4', { width: '5rem' })}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('kw_peak',   '670',   { width: '4.5rem' })}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>
        <select value={String(form.active)} onChange={e => set('active', e.target.value === 'true')}
          style={{ padding: '0.3rem', borderRadius: '5px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem' }}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
      </td>
      <td style={{ padding: '0.4rem 0.5rem' }}>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <button onClick={handleSave} style={{ padding: '0.3rem 0.7rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: '5px', fontWeight: '700', fontSize: '0.78rem', cursor: 'pointer' }}>Save</button>
          <button onClick={onCancel} style={{ padding: '0.3rem 0.7rem', background: BORDER_FAINT, color: TEXT_SECONDARY, border: 'none', borderRadius: '5px', fontSize: '0.78rem', cursor: 'pointer' }}>Cancel</button>
        </div>
      </td>
    </tr>
  )
}

export default function PanelTypesTab() {
  const [panels, setPanels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [addingNew, setAddingNew] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    getProducts('panel')
      .then(data => { setPanels(data); setLoading(false) })
      .catch(() => { setError('Failed to load panels'); setLoading(false) })
  }, [])

  const handleCreate = async (form) => {
    try {
      const created = await createProduct({ ...form, product_type: 'panel' })
      setPanels(prev => [...prev, created])
      setAddingNew(false)
    } catch { setError('Failed to create panel') }
  }

  const handleUpdate = async (id, form) => {
    try {
      const updated = await updateProduct(id, form)
      setPanels(prev => prev.map(p => p.id === id ? updated : p))
      setEditingId(null)
    } catch { setError('Failed to update panel') }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this panel?')) return
    try {
      await deleteProduct(id)
      setPanels(prev => prev.filter(p => p.id !== id))
    } catch { setError('Failed to delete panel') }
  }

  const handleToggleActive = async (p) => {
    try {
      const updated = await updateProduct(p.id, { active: !p.active })
      setPanels(prev => prev.map(x => x.id === p.id ? updated : x))
    } catch { setError('Failed to update') }
  }

  const filtered = panels.filter(p =>
    !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.type_key.toLowerCase().includes(filter.toLowerCase())
  )

  const thStyle: React.CSSProperties = { padding: '0.55rem 0.75rem', fontSize: '0.72rem', fontWeight: '700', color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', background: BG_SUBTLE, borderBottom: `1px solid ${BORDER_LIGHT}` }

  if (loading) return <div style={{ padding: '2rem', color: TEXT_LIGHT }}>Loading…</div>

  return (
    <div>
      {error && <div style={{ padding: '0.6rem 0.8rem', background: ERROR_BG, color: ERROR, borderRadius: '8px', marginBottom: '1rem', fontSize: '0.83rem' }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <input
          value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filter by name or key…"
          style={{ padding: '0.4rem 0.7rem', borderRadius: '7px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.85rem', width: '240px', outline: 'none' }}
        />
        <button
          onClick={() => { setAddingNew(true); setEditingId(null) }}
          disabled={addingNew}
          style={{ padding: '0.4rem 0.9rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: '7px', fontWeight: '700', fontSize: '0.83rem', cursor: 'pointer' }}
        >
          + Add Panel
        </button>
      </div>

      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '480px', border: `1px solid ${BORDER_LIGHT}`, borderRadius: '10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem', whiteSpace: 'nowrap' }}>
          <thead>
            <tr>
              <th style={thStyle}>Key</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>P.N.</th>
              <th style={thStyle}>L (cm)</th>
              <th style={thStyle}>W (cm)</th>
              <th style={thStyle}>Wp</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {addingNew && (
              <EditRow product={null} onSave={handleCreate} onCancel={() => setAddingNew(false)} />
            )}
            {filtered.length === 0 && !addingNew && (
              <tr>
                <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: TEXT_LIGHT, fontSize: '0.83rem' }}>
                  No panels defined yet.
                </td>
              </tr>
            )}
            {filtered.map((p, i) => (
              editingId === p.id ? (
                <EditRow key={p.id} product={p} onSave={(form) => handleUpdate(p.id, form)} onCancel={() => setEditingId(null)} />
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
                      {p.active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td style={{ padding: '0.45rem 0.75rem' }}>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button onClick={() => { setEditingId(p.id); setAddingNew(false) }}
                        style={{ padding: '0.2rem 0.55rem', background: BORDER_FAINT, color: TEXT_SECONDARY, border: 'none', borderRadius: '5px', fontSize: '0.75rem', cursor: 'pointer' }}>
                        Edit
                      </button>
                      <button onClick={() => handleDelete(p.id)}
                        style={{ padding: '0.2rem 0.55rem', background: 'transparent', color: DANGER, border: `1px solid ${DANGER}`, borderRadius: '5px', fontSize: '0.75rem', cursor: 'pointer' }}>
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: TEXT_VERY_LIGHT }}>{filtered.length} panel{filtered.length !== 1 ? 's' : ''}</div>
    </div>
  )
}
