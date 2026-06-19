import { useState, useEffect, useRef } from 'react'
import { listProjects, updateProject, deleteProject } from '../../services/projectsApi'
import ReassignOwnerModal from './ReassignOwnerModal'
import LinkCell from './LinkCell'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, ERROR, ERROR_BG, DANGER,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

const PAGE_SIZE = 50

export default function ProjectsTab({ onNavigate = null, nav = null }: { onNavigate?: ((t: any) => void) | null; nav?: any }) {
  const { t } = useLang()
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState(nav?.search ?? '')
  const [appliedSearch, setAppliedSearch] = useState(nav?.search ?? '')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Apply an inbound cross-link search once per navigation (key-guarded).
  const lastNavTok = useRef(nav?.key ?? 0)
  useEffect(() => {
    if (nav?.key && nav.key !== lastNavTok.current) {
      lastNavTok.current = nav.key
      setSearchInput(nav.search ?? ''); setAppliedSearch(nav.search ?? '')
    }
  }, [nav?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  // Reassign modal + local owner overrides so the row updates without a reload.
  const [reassign, setReassign] = useState<any>(null)
  const [ownerOverrides, setOwnerOverrides] = useState<Record<string, string>>({})
  // Edit modal (rename / client / location).
  const [editProject, setEditProject] = useState<any>(null)
  const [editName, setEditName] = useState('')
  const [editClient, setEditClient] = useState('')
  const [editLocation, setEditLocation] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const loadFirstPage = (search: string) => {
    setLoading(true); setError(null)
    listProjects({ limit: PAGE_SIZE, offset: 0, search: search || null })
      .then(res => { setRows(res.projects); setTotal(res.total); setHasMore(res.has_more) })
      .catch(() => setError(t('admin.projects.loadFailed')))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadFirstPage(appliedSearch) }, [appliedSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSearchChange = (v: string) => {
    setSearchInput(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setAppliedSearch(v.trim()), 350)
  }
  const clearSearch = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setSearchInput(''); setAppliedSearch('')
  }

  const loadMore = () => {
    setLoadingMore(true)
    listProjects({ limit: PAGE_SIZE, offset: rows.length, search: appliedSearch || null })
      .then(res => { setRows(prev => [...prev, ...res.projects]); setHasMore(res.has_more) })
      .catch(() => setError(t('admin.projects.loadFailed')))
      .finally(() => setLoadingMore(false))
  }

  const openEdit = (p: any) => {
    setEditProject(p)
    setEditName(p.name || '')
    setEditClient(p.client_name || '')
    setEditLocation(p.location || '')
  }
  const saveEdit = async () => {
    if (!editName.trim() || !editClient.trim()) return
    setSavingEdit(true)
    try {
      await updateProject(editProject.id, { name: editName.trim(), client_name: editClient.trim(), location: editLocation.trim() || null })
      setRows(prev => prev.map(r => r.id === editProject.id
        ? { ...r, name: editName.trim(), client_name: editClient.trim(), location: editLocation.trim() || null }
        : r))
      setEditProject(null)
    } catch (err: any) {
      setError(err?.message || t('admin.projects.loadFailed'))
    } finally {
      setSavingEdit(false)
    }
  }
  const handleDelete = async (p: any) => {
    if (!confirm(t('app.deleteProjectConfirm'))) return
    try {
      await deleteProject(p.id)
      setRows(prev => prev.filter(r => r.id !== p.id))
      setTotal(tt => Math.max(0, tt - 1))
    } catch (err: any) {
      setError(err?.message || t('admin.projects.loadFailed'))
    }
  }

  const iconBtnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: TEXT_VERY_LIGHT, padding: '0.3rem', display: 'inline-flex', alignItems: 'center' } as const

  const COLS = [
    t('admin.projects.col.name'),
    t('admin.projects.col.client'),
    t('admin.projects.col.owner'),
    t('admin.projects.col.updated'),
    t('admin.common.actions'),
  ]

  return (
    <div>
      {reassign && (
        <ReassignOwnerModal
          project={reassign}
          onClose={() => setReassign(null)}
          onReassigned={(id, _ownerId, ownerEmail) => {
            setOwnerOverrides(o => ({ ...o, [id]: ownerEmail }))
            setReassign(null)
          }}
        />
      )}

      {editProject && (
        <div onClick={() => setEditProject(null)} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '14px', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', width: '100%', maxWidth: '420px', padding: '1.5rem' }}>
            <div style={{ fontSize: '1rem', fontWeight: '700', color: TEXT_DARKEST, marginBottom: '1rem' }}>{t('welcome.editProject')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
              <input value={editName} onChange={e => setEditName(e.target.value)} placeholder={t('welcome.projectName')} autoFocus
                style={{ padding: '0.55rem 0.7rem', boxSizing: 'border-box', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.88rem', outline: 'none' }} />
              <input value={editClient} onChange={e => setEditClient(e.target.value)} placeholder={t('welcome.clientName')}
                style={{ padding: '0.55rem 0.7rem', boxSizing: 'border-box', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.88rem', outline: 'none' }} />
              <input value={editLocation} onChange={e => setEditLocation(e.target.value)} placeholder={t('welcome.location')}
                style={{ padding: '0.55rem 0.7rem', boxSizing: 'border-box', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: '8px', fontSize: '0.88rem', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button onClick={() => setEditProject(null)} style={{ padding: '0.45rem 1rem', borderRadius: '7px', border: `1px solid ${BORDER_LIGHT}`, background: BG_SUBTLE, color: TEXT_SECONDARY, fontSize: '0.83rem', fontWeight: '600', cursor: 'pointer' }}>
                {t('welcome.cancel')}
              </button>
              <button onClick={saveEdit} disabled={savingEdit || !editName.trim() || !editClient.trim()}
                style={{ padding: '0.45rem 1.2rem', borderRadius: '7px', border: 'none', background: (savingEdit || !editName.trim() || !editClient.trim()) ? BORDER_LIGHT : PRIMARY, color: (savingEdit || !editName.trim() || !editClient.trim()) ? TEXT_VERY_LIGHT : TEXT, fontSize: '0.83rem', fontWeight: '700', cursor: (savingEdit || !editName.trim() || !editClient.trim()) ? 'default' : 'pointer' }}>
                {t('welcome.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search toolbar — server-side match on name / location / owner email. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <input
          value={searchInput}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={t('admin.projects.searchPlaceholder')}
          style={{ flex: 1, padding: '0.45rem 0.65rem', boxSizing: 'border-box', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 7, fontSize: '0.85rem', outline: 'none' }}
        />
        {searchInput && (
          <button onClick={clearSearch} style={{ background: 'white', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 7, padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.78rem', color: TEXT_SECONDARY }}>
            {t('admin.common.clear')}
          </button>
        )}
        <div style={{ fontSize: '0.75rem', color: TEXT_VERY_LIGHT, whiteSpace: 'nowrap' }}>
          {loading ? t('admin.common.loading') : t('admin.projects.showing', { shown: rows.length, total })}
        </div>
      </div>

      {error && <div style={{ padding: '0.55rem 0.75rem', background: ERROR_BG, color: ERROR, borderRadius: 8, marginBottom: '0.75rem', fontSize: '0.82rem' }}>{error}</div>}

      {loading && rows.length === 0 ? (
        <div style={{ padding: '2rem', color: TEXT_LIGHT, fontSize: '0.88rem' }}>{t('admin.common.loading')}</div>
      ) : rows.length === 0 ? (
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
              {rows.map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${BORDER_FAINT}` }}>
                  <td style={{ padding: '0.6rem 0.75rem', fontWeight: '600', color: TEXT_DARKEST }}>{p.name}</td>
                  <td style={{ padding: '0.6rem 0.75rem', color: TEXT_SECONDARY }}>{p.client_name || '—'}</td>
                  <td style={{ padding: '0.6rem 0.75rem', color: TEXT_SECONDARY }}>
                    {(() => { const oe = ownerOverrides[p.id] ?? p.owner_email
                      return onNavigate && oe
                        ? <LinkCell title={t('admin.link.toLedger')} onClick={() => onNavigate({ tab: 'credits', subTab: 'lookup', selectEmail: oe })}>{oe}</LinkCell>
                        : (oe ?? '—') })()}
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem', color: TEXT_LIGHT, whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                    {new Date(p.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td style={{ padding: '0.6rem 0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      {/* Edit */}
                      <button onClick={() => openEdit(p)} title={t('welcome.editProject')} style={iconBtnStyle}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      {/* Reassign owner */}
                      <button onClick={() => setReassign({ id: p.id, name: p.name })} title={t('welcome.reassignOwner')} style={iconBtnStyle}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/>
                        </svg>
                      </button>
                      {/* Delete */}
                      <button onClick={() => handleDelete(p)} title={t('welcome.deleteProject')} style={{ ...iconBtnStyle, color: DANGER }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              style={{ marginTop: '0.85rem', padding: '0.5rem 1.1rem', background: BG_SUBTLE, border: `1px solid ${BORDER_LIGHT}`, borderRadius: 7, cursor: loadingMore ? 'default' : 'pointer', fontSize: '0.82rem', fontWeight: '600', color: TEXT_SECONDARY }}
            >
              {loadingMore ? t('admin.common.loading') : t('admin.common.loadMore')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
