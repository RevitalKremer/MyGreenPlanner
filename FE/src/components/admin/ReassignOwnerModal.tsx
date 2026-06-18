import { useState, useEffect, useRef } from 'react'
import { getUsers, reassignProjectOwner } from '../../services/adminApi'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, ERROR,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

/**
 * Admin-only modal to reassign a project's owner. Company sharing is derived
 * from the owner's company, so handing a project to a company member makes it
 * visible to that whole company.
 *
 * Props:
 *   project      — { id, name }
 *   onClose      — () => void
 *   onReassigned — (projectId, ownerId, ownerEmail) => void  (update the row)
 */
export default function ReassignOwnerModal({ project, onClose, onReassigned }) {
  const { t } = useLang()
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [assigningId, setAssigningId] = useState(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLoading(true)
    getUsers({ limit: 25, offset: 0, search: appliedSearch || null })
      .then(res => setResults(res.rows))
      .catch(() => setError(t('admin.reassign.loadFailed')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedSearch])

  const onSearchChange = (v) => {
    setSearchInput(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAppliedSearch(v.trim()), 350)
  }

  const assign = async (user) => {
    setAssigningId(user.id)
    setError(null)
    try {
      const res = await reassignProjectOwner(project.id, user.id)
      onReassigned(project.id, res.owner_id, res.owner_email)
      onClose()
    } catch (err) {
      setError(err.message)
      setAssigningId(null)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '14px', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', width: '100%', maxWidth: '460px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '1.25rem 1.5rem 0.75rem' }}>
          <div style={{ fontSize: '1rem', fontWeight: '700', color: TEXT_DARKEST }}>{t('admin.reassign.title')}</div>
          <div style={{ fontSize: '0.8rem', color: TEXT_SECONDARY, marginTop: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </div>
          <div style={{ fontSize: '0.75rem', color: TEXT_LIGHT, marginTop: '0.35rem', lineHeight: 1.5 }}>
            {t('admin.reassign.hint')}
          </div>
          <input
            autoFocus
            value={searchInput}
            onChange={e => onSearchChange(e.target.value)}
            placeholder={t('admin.users.searchPlaceholder')}
            style={{ width: '100%', boxSizing: 'border-box', marginTop: '0.85rem', padding: '0.5rem 0.7rem', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.88rem', outline: 'none' }}
          />
          {error && <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: ERROR }}>{error}</div>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0.25rem 0.75rem 0.75rem' }}>
          {loading ? (
            <div style={{ padding: '1rem', color: TEXT_LIGHT, fontSize: '0.85rem' }}>{t('admin.common.loading')}</div>
          ) : results.length === 0 ? (
            <div style={{ padding: '1rem', color: TEXT_VERY_LIGHT, fontSize: '0.85rem' }}>{t('admin.reassign.noResults')}</div>
          ) : (
            results.map(u => (
              <button
                key={u.id}
                onClick={() => assign(u)}
                disabled={!!assigningId}
                style={{
                  width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
                  background: 'white', border: `1px solid ${BORDER_FAINT}`, borderRadius: '8px',
                  padding: '0.55rem 0.7rem', marginBottom: '0.4rem', cursor: assigningId ? 'default' : 'pointer',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: '600', color: TEXT_DARKEST, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name}</span>
                  <span style={{ display: 'block', fontSize: '0.74rem', color: TEXT_SECONDARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.email}{u.company_name ? ` · ${u.company_name}` : ''}
                  </span>
                </span>
                <span style={{ flexShrink: 0, fontSize: '0.75rem', fontWeight: '700', color: assigningId === u.id ? TEXT_VERY_LIGHT : PRIMARY }}>
                  {assigningId === u.id ? '…' : t('admin.reassign.assign')}
                </span>
              </button>
            ))
          )}
        </div>

        <div style={{ padding: '0.75rem 1.5rem', borderTop: `1px solid ${BORDER_FAINT}`, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '0.45rem 1rem', borderRadius: '7px', border: `1px solid ${BORDER_LIGHT}`, background: BG_SUBTLE, color: TEXT_SECONDARY, fontSize: '0.83rem', fontWeight: '600', cursor: 'pointer' }}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
