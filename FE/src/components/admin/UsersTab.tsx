import { useState, useEffect, useRef } from 'react'
import { getUsers, updateUser, deleteUser, getCompanies } from '../../services/adminApi'
import CompaniesTab from './CompaniesTab'
import LinkCell from './LinkCell'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, SUCCESS, SUCCESS_BG,
  ERROR, ERROR_BG, DANGER, WARNING, WARNING_BG,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

const ROLES = ['user', 'admin']

// Wrapper: sub-tabs for Users and Companies (mirrors the Credits tab's sub-tab
// structure). Company discounts are managed in the Companies sub-tab.
export default function UsersTab({ currentUserId, onNavigate = null, nav = null }) {
  const { t } = useLang()
  const [subTab, setSubTab] = useState<'users' | 'companies'>('users')
  // Apply an inbound navigation directive (switch sub-tab). Panes stay mounted
  // (display toggle) so a key-guarded effect inside each applies the search
  // exactly once per navigation — no stale re-apply on manual sub-tab switches.
  useEffect(() => { if (nav?.subTab) setSubTab(nav.subTab) }, [nav?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  const usersNav = nav && (nav.subTab ?? 'users') === 'users' ? nav : null
  const companiesNav = nav && nav.subTab === 'companies' ? nav : null
  return (
    <div style={{ padding: '1rem 0' }}>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.1rem', borderBottom: `1px solid ${BORDER_FAINT}` }}>
        {[
          { key: 'users', label: t('admin.users.subtab.users') },
          { key: 'companies', label: t('admin.users.subtab.companies') },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setSubTab(tab.key as any)}
            style={{
              padding: '0.55rem 0.95rem', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.86rem', fontWeight: subTab === tab.key ? 700 : 500,
              color: subTab === tab.key ? TEXT_DARKEST : TEXT_LIGHT,
              borderBottom: `2px solid ${subTab === tab.key ? TEXT_DARKEST : 'transparent'}`,
              marginBottom: '-1px',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div style={{ display: subTab === 'users' ? 'block' : 'none' }}>
        <UsersListPane currentUserId={currentUserId} onNavigate={onNavigate} navToken={usersNav?.key ?? 0} initialSearch={usersNav?.search ?? ''} />
      </div>
      <div style={{ display: subTab === 'companies' ? 'block' : 'none' }}>
        <CompaniesTab onNavigate={onNavigate} navToken={companiesNav?.key ?? 0} initialSearch={companiesNav?.search ?? ''} />
      </div>
    </div>
  )
}

function RoleBadge({ role, t }) {
  const isAdmin = role === 'admin'
  return (
    <span style={{
      display: 'inline-block', padding: '0.2rem 0.55rem',
      borderRadius: '20px', fontSize: '0.72rem', fontWeight: '700',
      background: isAdmin ? WARNING_BG : BG_SUBTLE,
      color: isAdmin ? WARNING : TEXT_SECONDARY,
    }}>
      {isAdmin ? t('admin.users.role.admin') : t('admin.users.role.user')}
    </span>
  )
}

function StatusDot({ active, verified, t }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      <span style={{ fontSize: '0.72rem', color: active ? SUCCESS : ERROR, fontWeight: '600' }}>
        {active ? `● ${t('admin.common.active')}` : `● ${t('admin.common.inactive')}`}
      </span>
      <span style={{ fontSize: '0.68rem', color: verified ? SUCCESS : WARNING, fontWeight: '500' }}>
        {verified ? `✓ ${t('admin.common.verified')}` : t('admin.common.unverified')}
      </span>
    </div>
  )
}

function UsersListPane({ currentUserId, onNavigate = null, navToken = 0, initialSearch = '' }) {
  const { t } = useLang()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState({}) // { [id]: true }
  const [saveErr, setSaveErr] = useState({})
  const [companies, setCompanies] = useState([]) // [{id, name}] for the assign picker
  // Demotion modal: set to the user being demoted to 'user' who has no company.
  const [demoteUser, setDemoteUser] = useState(null)
  const [demoteCompany, setDemoteCompany] = useState('')
  const [demoteErr, setDemoteErr] = useState(null)
  // Search: searchInput mirrors typing; appliedSearch is the debounced (350 ms)
  // value sent to the BE (matches email / name / company). Useful to list all
  // users of one company by searching the company name.
  const [searchInput, setSearchInput] = useState(initialSearch)
  const [appliedSearch, setAppliedSearch] = useState(initialSearch)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Apply an inbound cross-link search exactly once per navigation (key-guarded).
  const lastNavTok = useRef(navToken)
  useEffect(() => {
    if (navToken && navToken !== lastNavTok.current) {
      lastNavTok.current = navToken
      setSearchInput(initialSearch); setAppliedSearch(initialSearch)
    }
  }, [navToken]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    getCompanies().then(setCompanies).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    // Single big page (500 = BE max); search narrows server-side.
    getUsers({ limit: 500, offset: 0, search: appliedSearch || null })
      .then(res => setUsers(res.rows))
      .catch(() => setError(t('admin.users.failedLoad')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedSearch])

  const onSearchChange = (v) => {
    setSearchInput(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setAppliedSearch(v.trim()), 350)
  }
  const clearSearch = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    setSearchInput(''); setAppliedSearch('')
  }

  // Shared: PUT a patch for one user, manage per-row saving/error, swap the row.
  const applyPatch = async (user, patch) => {
    setSaving(s => ({ ...s, [user.id]: true }))
    setSaveErr(e => ({ ...e, [user.id]: null }))
    try {
      const updated = await updateUser(user.id, patch)
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
      return true
    } catch (err) {
      setSaveErr(e => ({ ...e, [user.id]: err.message }))
      return false
    } finally {
      setSaving(s => ({ ...s, [user.id]: false }))
    }
  }

  // Refresh the picker list when a brand-new company name was just used.
  const refreshCompaniesIfNew = (name) => {
    if (name && !companies.some(c => c.name.toLowerCase() === name.toLowerCase())) {
      getCompanies().then(setCompanies).catch(() => {})
    }
  }

  const handleRoleChange = async (user, role) => {
    // Atomic demotion: a user must belong to a company, but admins don't. When
    // demoting a company-less (ex-admin) user, open the modal to collect a
    // company and send it in the same update so they're never left company-less.
    if (role === 'user' && !user.company_id) {
      setDemoteUser(user); setDemoteCompany(''); setDemoteErr(null)
      return
    }
    await applyPatch(user, { role })
  }

  const confirmDemote = async () => {
    const name = demoteCompany.trim()
    if (!name) { setDemoteErr(t('admin.users.companyRequired')); return }
    const user = demoteUser
    setDemoteUser(null)
    const ok = await applyPatch(user, { role: 'user', company_name: name })
    if (ok) refreshCompaniesIfNew(name)
  }

  const handleCompanyChange = async (user, raw) => {
    const trimmed = String(raw).trim()
    const cur = user.company_name ?? ''
    if (trimmed === cur) return // no-op (covers blur without edit)
    // Empty clears the company (company_id: null); else get-or-create by name.
    const ok = await applyPatch(user, trimmed === '' ? { company_id: null } : { company_name: trimmed })
    if (ok) refreshCompaniesIfNew(trimmed)
  }

  const handleToggleActive = async (user) => {
    setSaving(s => ({ ...s, [user.id]: true }))
    setSaveErr(e => ({ ...e, [user.id]: null }))
    try {
      const updated = await updateUser(user.id, { is_active: !user.is_active })
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
    } catch (err) {
      setSaveErr(e => ({ ...e, [user.id]: err.message }))
    } finally {
      setSaving(s => ({ ...s, [user.id]: false }))
    }
  }

  const handleDelete = async (user) => {
    if (!confirm(t('admin.users.deleteConfirm', { name: user.full_name, email: user.email }))) return
    setSaving(s => ({ ...s, [user.id]: true }))
    setSaveErr(e => ({ ...e, [user.id]: null }))
    try {
      await deleteUser(user.id)
      setUsers(prev => prev.filter(u => u.id !== user.id))
    } catch (err) {
      setSaveErr(e => ({ ...e, [user.id]: err.message }))
      setSaving(s => ({ ...s, [user.id]: false }))
    }
  }

  const canEdit = (user) => !user.is_sysadmin
  const canDelete = (user) => !user.is_sysadmin && user.role !== 'admin' && user.id !== currentUserId

  // Only blank the view on the very first load; subsequent searches keep the
  // table visible and show progress in the toolbar.
  if (loading && users.length === 0 && !appliedSearch) return <div style={{ padding: '2rem', color: TEXT_LIGHT, fontSize: '0.88rem' }}>{t('admin.users.loading')}</div>
  if (error) return <div style={{ padding: '2rem', color: ERROR, fontSize: '0.88rem' }}>{error}</div>

  const COL_HEADERS = [
    t('admin.users.col.name'),
    t('admin.users.col.email'),
    t('admin.users.col.role'),
    t('admin.users.col.status'),
    t('admin.users.col.joined'),
    t('admin.users.col.company'),
    t('admin.common.actions'),
  ]

  return (
    <div>
      {/* Shared options for every row's company <input list="admin-companies">. */}
      <datalist id="admin-companies">
        {companies.map(c => <option key={c.id} value={c.name} />)}
      </datalist>

      {/* Atomic-demotion modal: pick/enter a company for a user being demoted
          from admin (admins are company-less, regular users must have one). */}
      {demoteUser && (
        <div
          onClick={() => setDemoteUser(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '12px', boxShadow: '0 8px 40px rgba(0,0,0,0.18)', width: '100%', maxWidth: '380px', padding: '1.5rem' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: '700', color: TEXT_DARKEST, marginBottom: '0.4rem' }}>
              {t('admin.users.demoteCompanyTitle')}
            </div>
            <div style={{ fontSize: '0.82rem', color: TEXT_SECONDARY, marginBottom: '0.9rem', lineHeight: 1.5 }}>
              {t('admin.users.demoteCompanyPrompt', { name: demoteUser.full_name })}
            </div>
            <input
              type="text" list="admin-companies" autoFocus
              value={demoteCompany}
              onChange={e => { setDemoteCompany(e.target.value); if (demoteErr) setDemoteErr(null) }}
              onKeyDown={e => { if (e.key === 'Enter') confirmDemote(); if (e.key === 'Escape') setDemoteUser(null) }}
              placeholder={t('admin.users.col.company')}
              style={{ width: '100%', boxSizing: 'border-box', padding: '0.55rem 0.7rem', borderRadius: '8px', border: `1.5px solid ${demoteErr ? ERROR : BORDER_LIGHT}`, fontSize: '0.9rem', outline: 'none' }}
            />
            {demoteErr && <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: ERROR }}>{demoteErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.1rem' }}>
              <button onClick={() => setDemoteUser(null)} style={{ padding: '0.5rem 1rem', borderRadius: '7px', border: `1px solid ${BORDER_LIGHT}`, background: BG_SUBTLE, color: TEXT_SECONDARY, fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer' }}>
                {t('common.cancel')}
              </button>
              <button onClick={confirmDemote} style={{ padding: '0.5rem 1.2rem', borderRadius: '7px', border: 'none', background: PRIMARY, color: TEXT, fontSize: '0.85rem', fontWeight: '700', cursor: 'pointer' }}>
                {t('common.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Search toolbar — server-side match on email / name / company. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <input
          value={searchInput}
          onChange={e => onSearchChange(e.target.value)}
          placeholder={t('admin.users.searchPlaceholder')}
          style={{
            flex: 1, padding: '0.45rem 0.65rem', boxSizing: 'border-box',
            border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 7, fontSize: '0.85rem', outline: 'none',
          }}
        />
        {searchInput && (
          <button
            onClick={clearSearch}
            style={{
              background: 'white', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 7,
              padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.78rem', color: TEXT_SECONDARY,
            }}
          >{t('admin.common.clear')}</button>
        )}
        <div style={{ fontSize: '0.75rem', color: TEXT_VERY_LIGHT, whiteSpace: 'nowrap' }}>
          {loading ? t('admin.common.loading') : t('admin.users.total', { count: users.length })}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${BORDER_LIGHT}` }}>
              {COL_HEADERS.map(h => (
                <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontSize: '0.75rem', fontWeight: '700', color: TEXT_SECONDARY, whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(user => (
              <tr key={user.id} style={{ borderBottom: `1px solid ${BORDER_FAINT}`, background: saving[user.id] ? BG_SUBTLE : 'white' }}>

                {/* Name */}
                <td style={{ padding: '0.6rem 0.75rem', fontWeight: '600', color: TEXT_DARKEST, whiteSpace: 'nowrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    {user.full_name}
                    {user.is_sysadmin && (
                      <span style={{ fontSize: '0.65rem', background: ERROR_BG, color: ERROR, borderRadius: '10px', padding: '0.1rem 0.45rem', fontWeight: '700' }}>
                        {t('admin.users.sysadminBadge')}
                      </span>
                    )}
                    {user.id === currentUserId && (
                      <span style={{ fontSize: '0.65rem', background: SUCCESS_BG, color: SUCCESS, borderRadius: '10px', padding: '0.1rem 0.45rem', fontWeight: '700' }}>
                        {t('admin.common.you')}
                      </span>
                    )}
                  </div>
                </td>

                {/* Email — links to the user's credit ledger (Credits ▸ User lookup) */}
                <td style={{ padding: '0.6rem 0.75rem', color: TEXT_SECONDARY }}>
                  {onNavigate
                    ? <LinkCell title={t('admin.link.toLedger')} onClick={() => onNavigate({ tab: 'credits', subTab: 'lookup', selectEmail: user.email })}>{user.email}</LinkCell>
                    : user.email}
                </td>

                {/* Role */}
                <td style={{ padding: '0.6rem 0.75rem' }}>
                  {canEdit(user) ? (
                    <select
                      value={user.role}
                      onChange={e => handleRoleChange(user, e.target.value)}
                      disabled={!!saving[user.id]}
                      style={{
                        padding: '0.25rem 0.5rem', borderRadius: '6px',
                        border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem',
                        cursor: 'pointer', background: 'white',
                      }}
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r === 'admin' ? t('admin.users.role.admin') : t('admin.users.role.user')}</option>)}
                    </select>
                  ) : (
                    <RoleBadge role={user.role} t={t} />
                  )}
                </td>

                {/* Status */}
                <td style={{ padding: '0.6rem 0.75rem' }}>
                  {canEdit(user) ? (
                    <button
                      onClick={() => handleToggleActive(user)}
                      disabled={!!saving[user.id]}
                      style={{
                        padding: '0.2rem 0.6rem', borderRadius: '6px', cursor: 'pointer',
                        border: `1px solid ${user.is_active ? BORDER_LIGHT : ERROR}`,
                        background: user.is_active ? BG_SUBTLE : ERROR_BG,
                        color: user.is_active ? TEXT_SECONDARY : ERROR,
                        fontSize: '0.75rem', fontWeight: '600',
                      }}
                    >
                      {user.is_active ? t('admin.common.active') : t('admin.common.inactive')}
                    </button>
                  ) : (
                    <StatusDot active={user.is_active} verified={user.is_verified} t={t} />
                  )}
                  {!canEdit(user) ? null : (
                    <div style={{ fontSize: '0.68rem', color: user.is_verified ? TEXT_LIGHT : WARNING, marginTop: '2px' }}>
                      {user.is_verified ? t('admin.common.verified') : t('admin.common.unverified')}
                    </div>
                  )}
                </td>

                {/* Joined */}
                <td style={{ padding: '0.6rem 0.75rem', color: TEXT_LIGHT, whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                  {new Date(user.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                </td>

                {/* Company — editable for non-admins (pick existing via datalist
                    or type a new one); admins are company-less. */}
                <td style={{ padding: '0.6rem 0.75rem' }}>
                  {canEdit(user) && user.role !== 'admin' ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <input
                        type="text"
                        list="admin-companies"
                        defaultValue={user.company_name ?? ''}
                        disabled={!!saving[user.id]}
                        placeholder="—"
                        title={t('admin.users.companyTooltip')}
                        onBlur={e => handleCompanyChange(user, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                        style={{
                          width: '9rem', padding: '0.25rem 0.5rem', borderRadius: '6px',
                          border: `1px solid ${BORDER_LIGHT}`, fontSize: '0.8rem', background: 'white',
                        }}
                      />
                      {/* ↗ to manage this company (Companies sub-tab, filtered) */}
                      {onNavigate && user.company_name && (
                        <button
                          type="button"
                          title={t('admin.link.toCompany')}
                          onClick={() => onNavigate({ tab: 'users', subTab: 'companies', search: user.company_name })}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: PRIMARY, display: 'inline-flex', alignItems: 'center' }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                        </button>
                      )}
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: TEXT_VERY_LIGHT }}>—</span>
                  )}
                </td>

                {/* Actions */}
                <td style={{ padding: '0.6rem 0.75rem' }}>
                  {saveErr[user.id] && (
                    <div style={{ fontSize: '0.72rem', color: ERROR, marginBottom: '3px' }}>{saveErr[user.id]}</div>
                  )}
                  {canDelete(user) ? (
                    <button
                      onClick={() => handleDelete(user)}
                      disabled={!!saving[user.id]}
                      title={t('admin.users.deleteTooltip')}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: DANGER, padding: '0.3rem', display: 'inline-flex', alignItems: 'center' }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>
                  ) : (
                    <span style={{ fontSize: '0.72rem', color: TEXT_VERY_LIGHT }}>
                      {user.is_sysadmin ? t('admin.common.protected') : user.role === 'admin' ? t('admin.users.adminBadge') : user.id === currentUserId ? t('admin.common.you') : '—'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
