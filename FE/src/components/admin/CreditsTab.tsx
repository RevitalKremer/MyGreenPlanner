import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  PRIMARY, PRIMARY_BG, TEXT, TEXT_DARKEST, TEXT_DARK, TEXT_LIGHT, TEXT_VERY_LIGHT, TEXT_MUTED, TEXT_FAINT,
  BORDER_LIGHT, BORDER_FAINT, BG_SUBTLE, SUCCESS, SUCCESS_BG, ERROR, ERROR_BG,
  MODAL_SCRIM, MODAL_SHADOW,
  LEDGER_TRIAL_BG, LEDGER_GRANT_BG, LEDGER_REFUND_BG, LEDGER_PURCHASE_BG, LEDGER_CHARGE_BG,
} from '../../styles/colors'
import {
  getUsers,
  getCreditLedger,
  grantCredits,
  refundProjectCredits,
  getPendingRefunds,
  dismissRefundInbox,
} from '../../services/adminApi'
import MonetizationTab from './MonetizationTab'


const TXN_KIND_LABEL = {
  trial:           'Trial grant',
  admin_grant:     'Admin grant',
  admin_refund:    'Admin refund',
  purchase:        'Purchase',
  project_charge:  'Project charge',
}

const TXN_KIND_BG = {
  trial:           LEDGER_TRIAL_BG,
  admin_grant:     LEDGER_GRANT_BG,
  admin_refund:    LEDGER_REFUND_BG,
  purchase:        LEDGER_PURCHASE_BG,
  project_charge:  LEDGER_CHARGE_BG,
}


function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString() } catch { return iso }
}


/**
 * Admin credits console.
 *
 * Two sub-tabs:
 *   Pending refunds — projects awaiting a refund decision (charged + quoted,
 *                     not yet refunded, not yet dismissed).
 *   User credits    — pick a user, see their balance + full ledger, grant
 *                     credits or refund a specific charge.
 *
 * No admin can call this without auth — every action goes through admin-only
 * endpoints. The tab is only mounted inside AdminPanel which is gated by role.
 */
export default function CreditsTab() {
  const [subTab, setSubTab] = useState<'pending' | 'lookup' | 'monetization'>('pending')

  return (
    <div style={{ padding: '1rem 0' }}>
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1.1rem', borderBottom: `1px solid ${BORDER_FAINT}` }}>
        {[
          { key: 'pending',      label: 'Pending refunds' },
          { key: 'lookup',       label: 'User credits' },
          { key: 'monetization', label: 'Monetization' },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key as any)}
            style={{
              padding: '0.55rem 0.95rem', background: 'none', border: 'none', cursor: 'pointer',
              fontSize: '0.86rem', fontWeight: subTab === t.key ? 700 : 500,
              color: subTab === t.key ? TEXT_DARKEST : TEXT_LIGHT,
              borderBottom: `2px solid ${subTab === t.key ? TEXT_DARKEST : 'transparent'}`,
              marginBottom: '-1px',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subTab === 'pending'      && <PendingRefundsPane />}
      {subTab === 'lookup'       && <UserLookupPane />}
      {subTab === 'monetization' && <MonetizationTab />}
    </div>
  )
}


// ── Pending refunds inbox ───────────────────────────────────────────────────


const PAGE_SIZE = 50


function PendingRefundsPane() {
  const [rows, setRows] = useState<any[]>([])
  const [totalRows, setTotalRows] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)        // project_id currently being acted on
  const [confirming, setConfirming] = useState<null | { action: 'refund' | 'dismiss'; row: any; reason: string }>(null)

  // Search: input mirrors what the user types; appliedSearch is what's
  // actually sent to the BE (debounced 350 ms so we don't fire on every
  // keystroke). Changing appliedSearch resets pagination to offset 0.
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onSearchChange = (v: string) => {
    setSearchInput(v)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setAppliedSearch(v.trim()), 350)
  }
  const clearSearch = () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    setSearchInput('')
    setAppliedSearch('')
  }

  // Pull the first page (offset 0) whenever the applied search changes.
  const loadFirstPage = async (term: string) => {
    setLoading(true); setError(null)
    try {
      const data: any = await getPendingRefunds({ limit: PAGE_SIZE, offset: 0, search: term || null })
      setRows(data.rows ?? [])
      setTotalRows(data.total_rows ?? 0)
      setHasMore(!!data.has_more)
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { loadFirstPage(appliedSearch) }, [appliedSearch])

  const loadMore = async () => {
    if (!hasMore || loadingMore) return
    setLoadingMore(true); setError(null)
    try {
      const data: any = await getPendingRefunds({
        limit: PAGE_SIZE,
        offset: rows.length,
        search: appliedSearch || null,
      })
      setRows(prev => [...prev, ...(data.rows ?? [])])
      setTotalRows(data.total_rows ?? totalRows)
      setHasMore(!!data.has_more)
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoadingMore(false)
    }
  }

  const submitAction = async () => {
    if (!confirming) return
    const { action, row, reason } = confirming
    if (action === 'refund' && (!reason || !reason.trim())) return  // refund needs a reason
    setBusy(row.project_id)
    try {
      if (action === 'refund') {
        await refundProjectCredits(row.project_id, { reason })
      } else {
        await dismissRefundInbox(row.project_id, { reason: reason || null })
      }
      setRows(prev => prev.filter(r => r.project_id !== row.project_id))
      setTotalRows(t => Math.max(0, t - 1))
      setConfirming(null)
    } catch (e: any) {
      setError(e.message || 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ maxWidth: 1000 }}>
      <div style={{ marginBottom: '0.65rem', fontSize: '0.85rem', color: TEXT_MUTED }}>
        Projects that requested a quotation and are waiting on a refund decision. Refund once the order signs; dismiss if it won't.
      </div>

      {/* Search + counts toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
        <input
          value={searchInput}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search by project, owner email, reason, project id…"
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
              padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.78rem', color: TEXT_DARK,
            }}
          >✕ Clear</button>
        )}
        <div style={{ fontSize: '0.75rem', color: TEXT_VERY_LIGHT, whiteSpace: 'nowrap', minWidth: 110, textAlign: 'right' }}>
          {loading ? 'Loading…' : totalRows === 0 ? 'No rows' : `Showing ${rows.length} of ${totalRows}`}
        </div>
      </div>

      {error && <div style={{ padding: '0.55rem 0.75rem', background: ERROR_BG, color: ERROR, borderRadius: 8, marginBottom: '0.75rem', fontSize: '0.82rem' }}>{error}</div>}

      {loading ? (
        <div style={{ color: TEXT_VERY_LIGHT, fontSize: '0.88rem', padding: '0.5rem 0' }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '1.5rem', textAlign: 'center', color: TEXT_VERY_LIGHT, fontSize: '0.9rem', fontStyle: 'italic', border: `1px dashed ${BORDER_LIGHT}`, borderRadius: 10 }}>
          {appliedSearch
            ? 'No projects match this search.'
            : 'Nothing to refund. Quoted projects appear here once their charge is open.'}
        </div>
      ) : (
        <div style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.4fr 1.4fr 1fr 1fr 100px 230px',
            gap: '0.5rem', padding: '0.55rem 0.9rem', background: BG_SUBTLE,
            fontSize: '0.7rem', fontWeight: 700, color: TEXT_VERY_LIGHT,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <div>Project</div><div>Owner</div><div>Quoted</div><div>Charged</div>
            <div style={{ textAlign: 'right' }}>Amount</div><div />
          </div>
          {rows.map((r, i) => (
            <div key={r.project_id} style={{
              display: 'grid', gridTemplateColumns: '1.4fr 1.4fr 1fr 1fr 100px 230px',
              alignItems: 'center', gap: '0.5rem', padding: '0.65rem 0.9rem',
              borderTop: i > 0 ? `1px solid ${BORDER_FAINT}` : 'none',
              background: 'white',
            }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: TEXT_DARKEST, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.project_name}</div>
              <div style={{ fontSize: '0.82rem', color: TEXT_DARK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.owner_email}</div>
              <div style={{ fontSize: '0.78rem', color: TEXT_MUTED }}>{formatDate(r.quotation_requested_at)}</div>
              <div style={{ fontSize: '0.78rem', color: TEXT_MUTED }}>{formatDate(r.charged_at)}</div>
              <div style={{ fontSize: '0.92rem', fontWeight: 700, color: TEXT_DARKEST, textAlign: 'right' }}>{r.charge_amount}</div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setConfirming({ action: 'refund', row: r, reason: '' })}
                  disabled={!!busy}
                  style={{
                    background: PRIMARY, color: TEXT, border: 'none', borderRadius: 6,
                    padding: '0.35rem 0.7rem', cursor: busy ? 'default' : 'pointer',
                    fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap',
                    opacity: busy === r.project_id ? 0.6 : 1,
                  }}
                >Refund {r.charge_amount}</button>
                <button
                  onClick={() => setConfirming({ action: 'dismiss', row: r, reason: '' })}
                  disabled={!!busy}
                  style={{
                    background: 'white', color: TEXT_DARK, border: `1px solid ${BORDER_LIGHT}`,
                    borderRadius: 6, padding: '0.35rem 0.7rem', cursor: busy ? 'default' : 'pointer',
                    fontSize: '0.78rem', fontWeight: 700, whiteSpace: 'nowrap',
                  }}
                >Dismiss</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && !loading && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.85rem' }}>
          <button
            onClick={loadMore}
            disabled={loadingMore}
            style={{
              background: PRIMARY, color: TEXT, border: 'none', borderRadius: 7,
              padding: '0.45rem 1rem', fontSize: '0.82rem', fontWeight: 700,
              cursor: loadingMore ? 'default' : 'pointer', opacity: loadingMore ? 0.6 : 1,
            }}
          >{loadingMore ? 'Loading…' : 'Load more'}</button>
        </div>
      )}

      {confirming && (
        <ReasonPromptModal
          title={confirming.action === 'refund' ? `Refund ${confirming.row.charge_amount} credits to ${confirming.row.owner_email}` : 'Dismiss from inbox'}
          description={
            confirming.action === 'refund'
              ? 'This will credit the user back, mark the original charge as refunded, and email them.'
              : 'This hides the project from the inbox. It does NOT refund credits — the charge stays open and the project is still refundable from the User credits tab.'
          }
          reasonRequired={confirming.action === 'refund'}
          confirmLabel={confirming.action === 'refund' ? 'Refund' : 'Dismiss'}
          confirmBg={confirming.action === 'refund' ? PRIMARY : TEXT_DARK}
          confirmFg={confirming.action === 'refund' ? TEXT : 'white'}
          reason={confirming.reason}
          onReasonChange={r => setConfirming(c => c && { ...c, reason: r })}
          onCancel={() => setConfirming(null)}
          onSubmit={submitAction}
          busy={busy === confirming.row.project_id}
        />
      )}
    </div>
  )
}


// ── User lookup → balance + ledger + grant + refund-by-project ──────────────


function UserLookupPane() {
  // ── User list (left rail) — server-paginated + debounced search ────────
  const [users, setUsers] = useState<any[]>([])
  const [usersTotal, setUsersTotal] = useState(0)
  const [usersHasMore, setUsersHasMore] = useState(false)
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersLoadingMore, setUsersLoadingMore] = useState(false)
  const [userSearchInput, setUserSearchInput] = useState('')
  const [appliedUserSearch, setAppliedUserSearch] = useState('')
  const userSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Selected user (independent of the list — survives filtering) ──────
  const [selectedUser, setSelectedUser] = useState<any | null>(null)
  const selectedId = selectedUser?.id ?? null

  // ── Ledger pane — server-paginated + debounced search ─────────────────
  const [ledgerRows, setLedgerRows] = useState<any[]>([])
  const [ledgerSnapshot, setLedgerSnapshot] = useState<{ credits_available?: number; credits_used?: number; credits_total?: number }>({})
  const [ledgerTotal, setLedgerTotal] = useState(0)
  const [ledgerHasMore, setLedgerHasMore] = useState(false)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerLoadingMore, setLedgerLoadingMore] = useState(false)
  const [ledgerSearchInput, setLedgerSearchInput] = useState('')
  const [appliedLedgerSearch, setAppliedLedgerSearch] = useState('')
  const ledgerSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [error, setError] = useState<string | null>(null)

  // Grant form
  const [grantAmount, setGrantAmount] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [granting, setGranting] = useState(false)

  // Refund form (project picker driven by open project_charge rows in the ledger)
  const [refundProjectId, setRefundProjectId] = useState('')
  const [refundReason, setRefundReason] = useState('')
  const [refunding, setRefunding] = useState(false)

  const onUserSearchChange = (v: string) => {
    setUserSearchInput(v)
    if (userSearchTimer.current) clearTimeout(userSearchTimer.current)
    userSearchTimer.current = setTimeout(() => setAppliedUserSearch(v.trim()), 350)
  }
  const clearUserSearch = () => {
    if (userSearchTimer.current) clearTimeout(userSearchTimer.current)
    setUserSearchInput(''); setAppliedUserSearch('')
  }

  const onLedgerSearchChange = (v: string) => {
    setLedgerSearchInput(v)
    if (ledgerSearchTimer.current) clearTimeout(ledgerSearchTimer.current)
    ledgerSearchTimer.current = setTimeout(() => setAppliedLedgerSearch(v.trim()), 350)
  }
  const clearLedgerSearch = () => {
    if (ledgerSearchTimer.current) clearTimeout(ledgerSearchTimer.current)
    setLedgerSearchInput(''); setAppliedLedgerSearch('')
  }

  // ── User list loaders ─────────────────────────────────────────────────
  const loadUsersFirstPage = async (term: string) => {
    setUsersLoading(true); setError(null)
    try {
      const data = await getUsers({ limit: PAGE_SIZE, offset: 0, search: term || null })
      setUsers(data.rows ?? [])
      setUsersTotal(data.total_rows ?? 0)
      setUsersHasMore(!!data.has_more)
    } catch (e: any) {
      setError(e.message || 'Failed to load users')
    } finally {
      setUsersLoading(false)
    }
  }
  useEffect(() => { loadUsersFirstPage(appliedUserSearch) }, [appliedUserSearch])

  const loadMoreUsers = async () => {
    if (!usersHasMore || usersLoadingMore) return
    setUsersLoadingMore(true)
    try {
      const data = await getUsers({ limit: PAGE_SIZE, offset: users.length, search: appliedUserSearch || null })
      setUsers(prev => [...prev, ...(data.rows ?? [])])
      setUsersTotal(data.total_rows ?? usersTotal)
      setUsersHasMore(!!data.has_more)
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setUsersLoadingMore(false)
    }
  }

  // After grant/refund the picker balances are stale. Pull a fresh first
  // page (preserving the current applied search) so balances update.
  const refreshUserList = async () => {
    try {
      const data = await getUsers({ limit: Math.max(PAGE_SIZE, users.length), offset: 0, search: appliedUserSearch || null })
      setUsers(data.rows ?? [])
      setUsersTotal(data.total_rows ?? 0)
      setUsersHasMore(!!data.has_more)
      // Re-sync selectedUser balance if it's in the refreshed list.
      if (selectedId) {
        const fresh = (data.rows as any[]).find(u => u.id === selectedId)
        if (fresh) setSelectedUser(fresh)
      }
    } catch { /* swallow — error already surfaced by primary op */ }
  }

  // ── Ledger loaders ────────────────────────────────────────────────────
  const loadLedgerFirstPage = async (uid: string, term: string) => {
    setLedgerLoading(true); setError(null)
    try {
      const data: any = await getCreditLedger(uid, { limit: PAGE_SIZE, offset: 0, search: term || null })
      setLedgerRows(data.rows ?? [])
      setLedgerTotal(data.total_rows ?? 0)
      setLedgerHasMore(!!data.has_more)
      setLedgerSnapshot({
        credits_available: data.credits_available,
        credits_used: data.credits_used,
        credits_total: data.credits_total,
      })
    } catch (e: any) {
      setError(e.message || 'Failed to load ledger')
    } finally {
      setLedgerLoading(false)
    }
  }
  useEffect(() => {
    if (!selectedId) {
      setLedgerRows([]); setLedgerTotal(0); setLedgerHasMore(false); setLedgerSnapshot({})
      setAppliedLedgerSearch(''); setLedgerSearchInput('')
      return
    }
    loadLedgerFirstPage(selectedId, appliedLedgerSearch)
  }, [selectedId, appliedLedgerSearch])

  const loadMoreLedger = async () => {
    if (!selectedId || !ledgerHasMore || ledgerLoadingMore) return
    setLedgerLoadingMore(true)
    try {
      const data: any = await getCreditLedger(selectedId, {
        limit: PAGE_SIZE, offset: ledgerRows.length, search: appliedLedgerSearch || null,
      })
      setLedgerRows(prev => [...prev, ...(data.rows ?? [])])
      setLedgerTotal(data.total_rows ?? ledgerTotal)
      setLedgerHasMore(!!data.has_more)
    } catch (e: any) {
      setError(e.message || 'Failed to load')
    } finally {
      setLedgerLoadingMore(false)
    }
  }

  // After grant/refund: reset ledger to first page (so the new row shows up
  // and the snapshot reflects the new balance). Don't preserve search — the
  // user almost always wants to see the new row, which would match nothing
  // if they were searching for something specific.
  const refreshLedger = async () => {
    if (!selectedId) return
    await loadLedgerFirstPage(selectedId, appliedLedgerSearch)
  }

  const openCharges = useMemo(
    () => ledgerRows.filter(r => r.kind === 'project_charge' && !r.refunded),
    [ledgerRows]
  )

  const handleGrant = async () => {
    if (!selectedId) return
    const amt = Number(grantAmount)
    if (!Number.isFinite(amt) || amt <= 0) { setError('Grant amount must be a positive number'); return }
    if (!grantReason.trim()) { setError('Reason is required'); return }
    setError(null); setGranting(true)
    try {
      await grantCredits(selectedId, { amount: amt, reason: grantReason.trim() })
      setGrantAmount(''); setGrantReason('')
      await refreshUserList()
      await refreshLedger()
    } catch (e: any) {
      setError(e.message || 'Grant failed')
    } finally {
      setGranting(false)
    }
  }

  const handleRefund = async () => {
    if (!refundProjectId) return
    if (!refundReason.trim()) { setError('Reason is required for a refund'); return }
    setError(null); setRefunding(true)
    try {
      await refundProjectCredits(refundProjectId, { reason: refundReason.trim() })
      setRefundProjectId(''); setRefundReason('')
      await refreshUserList()
      await refreshLedger()
    } catch (e: any) {
      setError(e.message || 'Refund failed')
    } finally {
      setRefunding(false)
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: '1rem', alignItems: 'start' }}>

      {/* ── Left rail: user picker ─────────────────────────────────────── */}
      <div style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: 10, overflow: 'hidden', background: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${BORDER_FAINT}` }}>
          <input
            value={userSearchInput}
            onChange={e => onUserSearchChange(e.target.value)}
            placeholder="Search by email or name…"
            style={{
              flex: 1, padding: '0.5rem 0.7rem', boxSizing: 'border-box',
              border: 'none', fontSize: '0.85rem', outline: 'none',
            }}
          />
          {userSearchInput && (
            <button onClick={clearUserSearch} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: TEXT_VERY_LIGHT, fontSize: '0.85rem', padding: '0 0.6rem',
            }}>✕</button>
          )}
        </div>
        <div style={{ padding: '0.35rem 0.7rem', fontSize: '0.7rem', color: TEXT_VERY_LIGHT, background: BG_SUBTLE }}>
          {usersLoading ? 'Loading…' : usersTotal === 0 ? 'No users match' : `${users.length} of ${usersTotal}`}
        </div>
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          {users.map(u => {
            const isSelected = u.id === selectedId
            return (
              <button
                key={u.id}
                onClick={() => setSelectedUser(u)}
                style={{
                  width: '100%', textAlign: 'left',
                  padding: '0.55rem 0.7rem',
                  border: 'none', cursor: 'pointer',
                  background: isSelected ? BG_SUBTLE : 'white',
                  borderBottom: `1px solid ${BORDER_FAINT}`,
                  display: 'flex', flexDirection: 'column', gap: 2,
                }}
              >
                <span style={{ fontSize: '0.84rem', fontWeight: isSelected ? 700 : 600, color: TEXT_DARKEST, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.full_name || '—'}</span>
                <span style={{ fontSize: '0.74rem', color: TEXT_VERY_LIGHT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.email}</span>
                <span style={{ fontSize: '0.7rem', color: u.role === 'admin' ? TEXT_FAINT : TEXT_DARK, fontWeight: 700 }}>
                  {u.role === 'admin' ? '— admin —' : `${u.credits_available ?? 0} cr`}
                </span>
              </button>
            )
          })}
          {usersHasMore && (
            <button
              onClick={loadMoreUsers}
              disabled={usersLoadingMore}
              style={{
                width: '100%', padding: '0.55rem 0.7rem', border: 'none',
                background: 'white', borderBottom: `1px solid ${BORDER_FAINT}`,
                cursor: usersLoadingMore ? 'default' : 'pointer',
                color: TEXT_DARK, fontSize: '0.78rem', fontWeight: 700,
                opacity: usersLoadingMore ? 0.6 : 1,
              }}
            >{usersLoadingMore ? 'Loading…' : 'Load more'}</button>
          )}
        </div>
      </div>

      {/* ── Right pane: selected user details ──────────────────────────── */}
      <div>
        {error && <div style={{ padding: '0.55rem 0.75rem', background: ERROR_BG, color: ERROR, borderRadius: 8, marginBottom: '0.75rem', fontSize: '0.82rem' }}>{error}</div>}

        {!selectedUser ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: TEXT_VERY_LIGHT, fontSize: '0.9rem', fontStyle: 'italic', border: `1px dashed ${BORDER_LIGHT}`, borderRadius: 10 }}>
            Pick a user to view their credits and history.
          </div>
        ) : selectedUser.role === 'admin' ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: TEXT_VERY_LIGHT, fontSize: '0.9rem', fontStyle: 'italic', border: `1px dashed ${BORDER_LIGHT}`, borderRadius: 10 }}>
            This user is an admin — credits don't apply.
          </div>
        ) : (
          <>
            {/* Balance header */}
            <div style={{
              display: 'flex', gap: '0.5rem', marginBottom: '1rem',
            }}>
              {[
                { label: 'Available', value: ledgerSnapshot.credits_available ?? selectedUser.credits_available ?? 0, accent: true },
                { label: 'Held by projects', value: ledgerSnapshot.credits_used ?? selectedUser.credits_used ?? 0 },
                { label: 'Total', value: ledgerSnapshot.credits_total ?? selectedUser.credits_total ?? 0 },
              ].map(b => (
                <div key={b.label} style={{
                  flex: 1, background: b.accent ? PRIMARY_BG : 'white',
                  border: `1.5px solid ${b.accent ? PRIMARY : BORDER_LIGHT}`,
                  borderRadius: 10, padding: '0.7rem 0.9rem',
                }}>
                  <div style={{ fontSize: '0.66rem', color: TEXT_VERY_LIGHT, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{b.label}</div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 800, color: TEXT_DARKEST, lineHeight: 1.1 }}>{b.value}</div>
                </div>
              ))}
            </div>

            {/* Grant + Refund forms — side by side */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
              {/* Grant */}
              <div style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: 10, padding: '0.8rem' }}>
                <div style={{ fontSize: '0.86rem', fontWeight: 700, color: TEXT_DARKEST, marginBottom: '0.5rem' }}>Grant credits</div>
                <input
                  value={grantAmount} onChange={e => setGrantAmount(e.target.value)}
                  placeholder="Amount" type="number" min="1"
                  style={{ width: '100%', padding: '0.45rem 0.6rem', boxSizing: 'border-box', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 6, fontSize: '0.86rem', marginBottom: '0.45rem', outline: 'none' }}
                />
                <input
                  value={grantReason} onChange={e => setGrantReason(e.target.value)}
                  placeholder="Reason (required)"
                  style={{ width: '100%', padding: '0.45rem 0.6rem', boxSizing: 'border-box', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 6, fontSize: '0.86rem', marginBottom: '0.5rem', outline: 'none' }}
                />
                <button
                  onClick={handleGrant}
                  disabled={granting || !grantAmount || !grantReason.trim()}
                  style={{
                    width: '100%', padding: '0.45rem 0.7rem', background: PRIMARY,
                    color: TEXT, border: 'none', borderRadius: 6,
                    fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                    opacity: (granting || !grantAmount || !grantReason.trim()) ? 0.5 : 1,
                  }}
                >{granting ? '…' : 'Grant'}</button>
              </div>

              {/* Refund */}
              <div style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: 10, padding: '0.8rem' }}>
                <div style={{ fontSize: '0.86rem', fontWeight: 700, color: TEXT_DARKEST, marginBottom: '0.5rem' }}>Refund a project</div>
                {openCharges.length === 0 ? (
                  <div style={{ fontSize: '0.78rem', color: TEXT_VERY_LIGHT, fontStyle: 'italic', padding: '0.4rem 0' }}>
                    No open charges to refund.
                  </div>
                ) : (
                  <>
                    <select
                      value={refundProjectId}
                      onChange={e => setRefundProjectId(e.target.value)}
                      style={{ width: '100%', padding: '0.45rem 0.6rem', boxSizing: 'border-box', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 6, fontSize: '0.86rem', marginBottom: '0.45rem', outline: 'none', background: 'white' }}
                    >
                      <option value="">— pick a project —</option>
                      {openCharges.map(c => (
                        <option key={c.id} value={c.project_id}>
                          {Math.abs(c.amount)} cr · {formatDate(c.created_at).slice(0, 10)} · {String(c.project_id).slice(0, 8)}…
                        </option>
                      ))}
                    </select>
                    <input
                      value={refundReason} onChange={e => setRefundReason(e.target.value)}
                      placeholder="Reason (required)"
                      style={{ width: '100%', padding: '0.45rem 0.6rem', boxSizing: 'border-box', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 6, fontSize: '0.86rem', marginBottom: '0.5rem', outline: 'none' }}
                    />
                    <button
                      onClick={handleRefund}
                      disabled={refunding || !refundProjectId || !refundReason.trim()}
                      style={{
                        width: '100%', padding: '0.45rem 0.7rem', background: PRIMARY,
                        color: TEXT, border: 'none', borderRadius: 6,
                        fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
                        opacity: (refunding || !refundProjectId || !refundReason.trim()) ? 0.5 : 1,
                      }}
                    >{refunding ? '…' : 'Refund'}</button>
                  </>
                )}
              </div>
            </div>

            {/* Ledger — header + search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.8rem', fontWeight: 700, color: TEXT_VERY_LIGHT, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ledger</div>
              <input
                value={ledgerSearchInput}
                onChange={e => onLedgerSearchChange(e.target.value)}
                placeholder="Search by reason, kind, project id…"
                style={{
                  flex: 1, padding: '0.4rem 0.6rem', boxSizing: 'border-box',
                  border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 6,
                  fontSize: '0.82rem', outline: 'none',
                }}
              />
              {ledgerSearchInput && (
                <button onClick={clearLedgerSearch} style={{
                  background: 'white', border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 6,
                  padding: '0.35rem 0.6rem', cursor: 'pointer', fontSize: '0.74rem', color: TEXT_DARK,
                }}>✕</button>
              )}
              <span style={{ fontSize: '0.72rem', color: TEXT_VERY_LIGHT, whiteSpace: 'nowrap' }}>
                {ledgerLoading ? 'Loading…' : ledgerTotal === 0 ? '—' : `${ledgerRows.length} / ${ledgerTotal}`}
              </span>
            </div>

            {ledgerLoading ? (
              <div style={{ color: TEXT_VERY_LIGHT, fontSize: '0.85rem' }}>Loading…</div>
            ) : ledgerRows.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: TEXT_VERY_LIGHT, fontStyle: 'italic', fontSize: '0.85rem', border: `1px dashed ${BORDER_LIGHT}`, borderRadius: 10 }}>
                {appliedLedgerSearch ? 'No transactions match this search.' : 'No transactions yet.'}
              </div>
            ) : (
              <div style={{ border: `1px solid ${BORDER_LIGHT}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{
                  display: 'grid', gridTemplateColumns: '110px 130px 90px 1fr 1fr',
                  gap: '0.5rem', padding: '0.45rem 0.75rem', background: BG_SUBTLE,
                  fontSize: '0.66rem', fontWeight: 700, color: TEXT_VERY_LIGHT,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  <div>Date</div><div>Kind</div><div style={{ textAlign: 'right' }}>Amount</div><div>Reason</div><div>Project</div>
                </div>
                {ledgerRows.map((r: any, i: number) => (
                  <div key={r.id} style={{
                    display: 'grid', gridTemplateColumns: '110px 130px 90px 1fr 1fr',
                    gap: '0.5rem', padding: '0.45rem 0.75rem',
                    fontSize: '0.78rem', color: TEXT_DARK,
                    borderTop: i > 0 ? `1px solid ${BORDER_FAINT}` : 'none',
                  }}>
                    <div style={{ color: TEXT_MUTED }}>{formatDate(r.created_at).slice(0, 16)}</div>
                    <div>
                      <span style={{
                        background: TXN_KIND_BG[r.kind] ?? BG_SUBTLE,
                        padding: '1px 6px', borderRadius: 4,
                        fontSize: '0.7rem', fontWeight: 700, color: TEXT_DARKEST,
                      }}>{TXN_KIND_LABEL[r.kind] ?? r.kind}</span>
                      {r.kind === 'project_charge' && r.refunded && (
                        <span style={{ marginInlineStart: 4, fontSize: '0.65rem', color: TEXT_VERY_LIGHT }}>(refunded)</span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', fontWeight: 700, color: r.amount < 0 ? ERROR : TEXT_DARKEST }}>
                      {r.amount > 0 ? '+' : ''}{r.amount}
                    </div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason || '—'}</div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.74rem', color: TEXT_VERY_LIGHT }}>
                      {r.project_id ? String(r.project_id).slice(0, 8) + '…' : '—'}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {ledgerHasMore && !ledgerLoading && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.65rem' }}>
                <button
                  onClick={loadMoreLedger}
                  disabled={ledgerLoadingMore}
                  style={{
                    background: PRIMARY, color: TEXT, border: 'none', borderRadius: 7,
                    padding: '0.4rem 0.9rem', fontSize: '0.78rem', fontWeight: 700,
                    cursor: ledgerLoadingMore ? 'default' : 'pointer', opacity: ledgerLoadingMore ? 0.6 : 1,
                  }}
                >{ledgerLoadingMore ? 'Loading…' : 'Load more'}</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}


// ── Shared reason-prompt modal ──────────────────────────────────────────────


function ReasonPromptModal({
  title, description, reasonRequired, confirmLabel, confirmBg, confirmFg,
  reason, onReasonChange, onCancel, onSubmit, busy,
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: MODAL_SCRIM,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1300, padding: '1rem',
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: 'white', borderRadius: 12, padding: '1.25rem 1.4rem',
        width: 'min(440px, 100%)', boxShadow: `0 12px 40px ${MODAL_SHADOW}`,
      }}>
        <div style={{ fontSize: '0.98rem', fontWeight: 800, color: TEXT_DARKEST, marginBottom: '0.4rem' }}>{title}</div>
        <div style={{ fontSize: '0.82rem', color: TEXT_MUTED, marginBottom: '0.75rem', lineHeight: 1.4 }}>{description}</div>
        <textarea
          value={reason}
          onChange={e => onReasonChange(e.target.value)}
          placeholder={reasonRequired ? 'Reason (required)' : 'Reason (optional)'}
          rows={3}
          style={{
            width: '100%', padding: '0.55rem 0.7rem', boxSizing: 'border-box',
            border: `1.5px solid ${BORDER_LIGHT}`, borderRadius: 8,
            fontSize: '0.88rem', outline: 'none', resize: 'vertical', fontFamily: 'inherit',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: '0.85rem' }}>
          <button onClick={onCancel} disabled={busy} style={{
            background: 'white', color: TEXT_DARK, border: `1.5px solid ${BORDER_LIGHT}`,
            borderRadius: 7, padding: '0.5rem 0.95rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
          }}>Cancel</button>
          <button
            onClick={onSubmit}
            disabled={busy || (reasonRequired && !reason.trim())}
            style={{
              background: confirmBg, color: confirmFg, border: 'none',
              borderRadius: 7, padding: '0.5rem 0.95rem', fontSize: '0.85rem', fontWeight: 700,
              cursor: busy ? 'default' : 'pointer',
              opacity: (busy || (reasonRequired && !reason.trim())) ? 0.55 : 1,
            }}
          >{busy ? '…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
