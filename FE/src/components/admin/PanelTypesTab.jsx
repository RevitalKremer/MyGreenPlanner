import { useState, useEffect } from 'react'
import { getProducts, createProduct, updateProduct, deleteProduct } from '../../services/adminApi'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, SUCCESS, SUCCESS_BG, ERROR, ERROR_BG,
  DANGER, ADD_GREEN_BG,
} from '../../styles/colors'

const emptyForm = { type_key: '', name: '', part_number: '', length_cm: '', width_cm: '', kw_peak: '', active: true, sort_order: 0 }

function EditRow({ product, onSave, onCancel }) {
  const [form, setForm] = useState({ ...emptyForm, ...product, length_cm: product?.length_cm ?? '', width_cm: product?.width_cm ?? '', kw_peak: product?.kw_peak ?? '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const handleSave = () => {
    if (!form.name.trim() || !form.type_key.trim()) return
    if (!form.length_cm || !form.width_cm || !form.kw_peak) return
    onSave({
      ...form,
      length_cm: Number(form.length_cm),
      width_cm: Number(form.width_cm),
      kw_peak: Number(form.kw_peak),
    })
  }
  const inp = (key, placeholder, extra = {}) => (
    <input
      value={form[key] ?? ''}
      onChange={e => set(key, e.target.value)}
      placeholder={placeholder}
      style={{ padding: '0.3rem 0.5rem', borderRadius: '5px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem', width: '100%', boxSizing: 'border-box', ...extra }}
    />
  )
  return (
    <tr style={{ background: ADD_GREEN_BG }}>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('type_key', 'e.g. AIKO-G670', { fontFamily: 'monospace' })}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('name', 'e.g. AIKO G670')}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('part_number', 'Part number')}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('length_cm', '238.2')}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('width_cm', '113.4')}</td>
      <td style={{ padding: '0.4rem 0.5rem' }}>{inp('kw_peak', '670')}</td>
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
  const [panelTypes, setPanelTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [addingNew, setAddingNew] = useState(false)

  useEffect(() => {
    getProducts()
      .then(data => {
        setPanelTypes(data.filter(p => p.length_cm != null && p.width_cm != null && p.kw_peak != null))
        setLoading(false)
      })
      .catch(() => { setError('Failed to load panel types'); setLoading(false) })
  }, [])

  const handleCreate = async (form) => {
    try {
      const created = await createProduct(form)
      setPanelTypes(prev => [...prev, created].sort((a, b) => a.sort_order - b.sort_order))
      setAddingNew(false)
    } catch { setError('Failed to create panel type') }
  }

  const handleUpdate = async (id, form) => {
    try {
      const updated = await updateProduct(id, form)
      setPanelTypes(prev => prev.map(p => p.id === id ? updated : p))
      setEditingId(null)
    } catch { setError('Failed to update panel type') }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this panel type?')) return
    try {
      await deleteProduct(id)
      setPanelTypes(prev => prev.filter(p => p.id !== id))
    } catch { setError('Failed to delete panel type') }
  }

  const handleToggleActive = async (p) => {
    try {
      const updated = await updateProduct(p.id, { active: !p.active })
      setPanelTypes(prev => prev.map(x => x.id === p.id ? updated : x))
    } catch { setError('Failed to update') }
  }

  const thStyle = {
    padding: '0.55rem 0.75rem', fontSize: '0.72rem', fontWeight: '700',
    color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em',
    textAlign: 'left', background: BG_SUBTLE, borderBottom: `1px solid ${BORDER_LIGHT}`,
  }

  if (loading) return <div style={{ padding: '2rem', color: TEXT_LIGHT }}>Loading…</div>

  return (
    <div>
      {error && <div style={{ padding: '0.6rem 0.8rem', background: ERROR_BG, color: ERROR, borderRadius: '8px', marginBottom: '1rem', fontSize: '0.83rem' }}>{error}</div>}

      <div style={{ marginBottom: '1rem', fontSize: '0.83rem', color: TEXT_LIGHT }}>
        Panel types appear in the panel selector during project setup. Each entry must have length, width, and Wp defined.
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
        <button
          onClick={() => { setAddingNew(true); setEditingId(null) }}
          disabled={addingNew}
          style={{ padding: '0.4rem 0.9rem', background: PRIMARY, color: TEXT, border: 'none', borderRadius: '7px', fontWeight: '700', fontSize: '0.83rem', cursor: 'pointer' }}
        >
          + Add Panel Type
        </button>
      </div>

      <div style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: '10px', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
          <thead>
            <tr>
              <th style={thStyle}>Key</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Part No.</th>
              <th style={thStyle}>Length (cm)</th>
              <th style={thStyle}>Width (cm)</th>
              <th style={thStyle}>Wp</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {addingNew && (
              <EditRow product={null} onSave={handleCreate} onCancel={() => setAddingNew(false)} />
            )}
            {panelTypes.length === 0 && !addingNew && (
              <tr>
                <td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: TEXT_LIGHT, fontSize: '0.83rem' }}>
                  No panel types defined yet. Click "+ Add Panel Type" to add one.
                </td>
              </tr>
            )}
            {panelTypes.map((p, i) => (
              editingId === p.id ? (
                <EditRow key={p.id} product={p} onSave={(form) => handleUpdate(p.id, form)} onCancel={() => setEditingId(null)} />
              ) : (
                <tr key={p.id} style={{ background: i % 2 === 0 ? 'white' : BG_SUBTLE, borderTop: `1px solid ${BORDER_FAINT}` }}>
                  <td style={{ padding: '0.45rem 0.75rem', fontFamily: 'monospace', fontSize: '0.75rem', color: TEXT_SECONDARY }}>{p.type_key}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, fontWeight: '500' }}>{p.name}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_LIGHT }}>{p.part_number || '—'}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, fontWeight: '600' }}>{p.length_cm}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, fontWeight: '600' }}>{p.width_cm}</td>
                  <td style={{ padding: '0.45rem 0.75rem', color: TEXT_DARKEST, fontWeight: '600' }}>{p.kw_peak} W</td>
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
      <div style={{ marginTop: '0.5rem', fontSize: '0.72rem', color: TEXT_VERY_LIGHT }}>{panelTypes.length} panel type{panelTypes.length !== 1 ? 's' : ''}</div>
    </div>
  )
}
