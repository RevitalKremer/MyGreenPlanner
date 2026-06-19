import { useState, useEffect } from 'react'
import { getCompanies, updateCompany, deleteCompany, AdminCompany } from '../../services/adminApi'
import {
  TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, ERROR, DANGER,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

export default function CompaniesTab() {
  const { t } = useLang()
  const [companies, setCompanies] = useState<AdminCompany[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saveErr, setSaveErr] = useState<Record<string, string | null>>({})
  const [search, setSearch] = useState('')
  // Delete modal: the company being deleted + chosen target to move members to.
  const [deleteTarget, setDeleteTarget] = useState<AdminCompany | null>(null)
  const [moveToId, setMoveToId] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)

  const reload = () => {
    setLoading(true)
    return getCompanies()
      .then(setCompanies)
      .catch(() => setError(t('admin.companies.loadFailed')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { reload() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true); setDeleteErr(null)
    try {
      await deleteCompany(deleteTarget.id, moveToId || null)
      setDeleteTarget(null); setMoveToId('')
      await reload()
    } catch (err: any) {
      setDeleteErr(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const patch = async (c: AdminCompany, data: { name?: string; discount_percent?: number | null }) => {
    setSaving(s => ({ ...s, [c.id]: true }))
    setSaveErr(e => ({ ...e, [c.id]: null }))
    try {
      const updated = await updateCompany(c.id, data)
      setCompanies(prev => prev.map(x => x.id === updated.id ? { ...x, ...updated } : x))
    } catch (err: any) {
      setSaveErr(e => ({ ...e, [c.id]: err.message }))
    } finally {
      setSaving(s => ({ ...s, [c.id]: false }))
    }
  }

  const onNameBlur = (c: AdminCompany, raw: string) => {
    const name = raw.trim()
    if (!name || name === c.name) return
    patch(c, { name })
  }
  const onDiscountBlur = (c: AdminCompany, raw: string) => {
    const trimmed = raw.trim()
    const next = trimmed === '' ? null : Math.min(100, Math.max(0, parseFloat(trimmed)))
    if (next !== null && Number.isNaN(next)) return
    if (next === (c.discount_percent ?? null)) return
    patch(c, { discount_percent: next })
  }

  const filtered = search.trim()
    ? companies.filter(c => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : companies

  const COLS = [t('admin.companies.col.name'), t('admin.companies.col.discount'), t('admin.companies.col.members'), t('admin.common.actions')]

  return (
    <div>
      {deleteTarget && (
        <div onClick={() => !deleting && setDeleteTarget(null)} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '14px', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', width: '100%', maxWidth: '420px', padding: '1.5rem' }}>
            <div style={{ fontSize: '1rem', fontWeight: '700', color: TEXT_DARKEST, marginBottom: '0.5rem' }}>
              {t('admin.companies.deleteTitle', { name: deleteTarget.name })}
            </div>
            <div style={{ fontSize: '0.83rem', color: TEXT_SECONDARY, marginBottom: '0.9rem', lineHeight: 1.5 }}>
              {deleteTarget.member_count > 0
                ? t('admin.companies.deleteMoveHint', { count: deleteTarget.member_count })
                : t('admin.companies.deleteNoMembers')}
            </div>
            {deleteTarget.member_count > 0 && (
              <select
                value={moveToId}
                onChange={e => setMoveToId(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box', padding: '0.55rem 0.7rem', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.88rem', background: 'white' }}
              >
                <option value="">{t('admin.companies.moveToNone')}</option>
                {companies.filter(c => c.id !== deleteTarget.id).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            {deleteErr && <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: ERROR }}>{deleteErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button onClick={() => setDeleteTarget(null)} disabled={deleting} style={{ padding: '0.45rem 1rem', borderRadius: '7px', border: `1px solid ${BORDER_LIGHT}`, background: BG_SUBTLE, color: TEXT_SECONDARY, fontSize: '0.83rem', fontWeight: '600', cursor: 'pointer' }}>
                {t('common.cancel')}
              </button>
              <button onClick={confirmDelete} disabled={deleting} style={{ padding: '0.45rem 1.2rem', borderRadius: '7px', border: 'none', background: DANGER, color: 'white', fontSize: '0.83rem', fontWeight: '700', cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.6 : 1 }}>
                {t('admin.common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('admin.companies.searchPlaceholder')}
          style={{ flex: 1, padding: '0.45rem 0.65rem', boxSizing: 'border-box', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 7, fontSize: '0.85rem', outline: 'none' }}
        />
        <div style={{ fontSize: '0.75rem', color: TEXT_VERY_LIGHT, whiteSpace: 'nowrap' }}>
          {loading ? t('admin.common.loading') : t('admin.companies.total', { count: filtered.length })}
        </div>
      </div>

      {error && <div style={{ padding: '0.55rem 0.75rem', background: ERROR, color: 'white', borderRadius: 8, marginBottom: '0.75rem', fontSize: '0.82rem' }}>{error}</div>}

      {loading ? (
        <div style={{ padding: '2rem', color: TEXT_LIGHT, fontSize: '0.88rem' }}>{t('admin.common.loading')}</div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: '2rem', color: TEXT_VERY_LIGHT, fontSize: '0.88rem' }}>{t('admin.common.noRows')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${BORDER_LIGHT}` }}>
                {COLS.map(h => (
                  <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: '700', color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id} style={{ borderBottom: `1px solid ${BORDER_FAINT}`, background: saving[c.id] ? BG_SUBTLE : 'white' }}>
                  {/* Name — editable */}
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <input
                      type="text"
                      defaultValue={c.name}
                      disabled={!!saving[c.id]}
                      title={t('admin.companies.nameTooltip')}
                      onBlur={e => onNameBlur(c, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
                      style={{ width: '14rem', maxWidth: '100%', padding: '0.25rem 0.5rem', borderRadius: '6px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.85rem', fontWeight: 600, color: TEXT_DARKEST, background: 'white' }}
                    />
                    {saveErr[c.id] && <div style={{ fontSize: '0.72rem', color: ERROR, marginTop: '3px' }}>{saveErr[c.id]}</div>}
                  </td>
                  {/* Discount % — editable, empty = none */}
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <input
                      type="number"
                      min={0} max={100} step={0.5}
                      defaultValue={c.discount_percent ?? ''}
                      disabled={!!saving[c.id]}
                      placeholder="—"
                      title={t('admin.companies.discountTooltip')}
                      onBlur={e => onDiscountBlur(c, e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur() }}
                      style={{ width: '4.5rem', padding: '0.25rem 0.5rem', borderRadius: '6px', border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem', background: 'white' }}
                    />
                  </td>
                  {/* Members */}
                  <td style={{ padding: '0.6rem 0.75rem', color: TEXT_SECONDARY }}>{c.member_count}</td>
                  {/* Actions */}
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <button
                      onClick={() => { setDeleteTarget(c); setMoveToId(''); setDeleteErr(null) }}
                      disabled={!!saving[c.id]}
                      title={t('admin.companies.deleteTooltip')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: DANGER, padding: '0.3rem', display: 'inline-flex', alignItems: 'center' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
