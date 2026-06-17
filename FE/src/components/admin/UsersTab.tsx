import { useState, useEffect } from 'react'
import { getUsers, updateUser, deleteUser } from '../../services/adminApi'
import {
  PRIMARY, TEXT, TEXT_DARKEST, TEXT_SECONDARY, TEXT_LIGHT, TEXT_VERY_LIGHT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, SUCCESS, SUCCESS_BG,
  ERROR, ERROR_BG, DANGER, WARNING, WARNING_BG,
} from '../../styles/colors'
import { useLang } from '../../i18n/LangContext'

const ROLES = ['user', 'admin']

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

export default function UsersTab({ currentUserId }) {
  const { t } = useLang()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState({}) // { [id]: true }
  const [saveErr, setSaveErr] = useState({})

  useEffect(() => {
    setLoading(true)
    // /admin/users is now paginated. UsersTab keeps its "single list"
    // UX; we just pull a big page (500 is the BE max). When this tab
    // gets its own search + Load More, switch to the same offset/search
    // state pattern as CreditsTab.
    getUsers({ limit: 500, offset: 0 })
      .then(res => setUsers(res.rows))
      .catch(() => setError(t('admin.users.failedLoad')))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleRoleChange = async (user, role) => {
    setSaving(s => ({ ...s, [user.id]: true }))
    setSaveErr(e => ({ ...e, [user.id]: null }))
    try {
      const updated = await updateUser(user.id, { role })
      setUsers(prev => prev.map(u => u.id === updated.id ? updated : u))
    } catch (err) {
      setSaveErr(e => ({ ...e, [user.id]: err.message }))
    } finally {
      setSaving(s => ({ ...s, [user.id]: false }))
    }
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

  if (loading) return <div style={{ padding: '2rem', color: TEXT_LIGHT, fontSize: '0.88rem' }}>{t('admin.users.loading')}</div>
  if (error) return <div style={{ padding: '2rem', color: ERROR, fontSize: '0.88rem' }}>{error}</div>

  const COL_HEADERS = [
    t('admin.users.col.name'),
    t('admin.users.col.email'),
    t('admin.users.col.role'),
    t('admin.users.col.status'),
    t('admin.users.col.joined'),
    t('admin.common.actions'),
  ]

  return (
    <div>
      <div style={{ fontSize: '0.78rem', color: TEXT_SECONDARY, marginBottom: '1rem' }}>
        {t('admin.users.total', { count: users.length })}
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

                {/* Email */}
                <td style={{ padding: '0.6rem 0.75rem', color: TEXT_SECONDARY }}>{user.email}</td>

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
                      style={{
                        background: 'none', border: `1px solid ${BORDER_LIGHT}`, cursor: 'pointer',
                        color: DANGER, borderRadius: '6px', padding: '0.25rem 0.55rem',
                        fontSize: '0.75rem', fontWeight: '600',
                      }}
                    >
                      {t('admin.common.delete')}
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
