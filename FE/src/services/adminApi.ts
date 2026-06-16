import { mgpRequest } from './mgpApi'

// Users — paginated list. Default page size matches the admin UI's
// "Load more" pattern across CreditsTab + UsersTab.
export const getUsers = async (
  opts: { limit?: number; offset?: number; search?: string | null } = {},
): Promise<{ rows: any[]; total_rows: number; has_more: boolean }> => {
  const { limit = 50, offset = 0, search = null } = opts
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (search && search.trim()) params.set('search', search.trim())
  const res = await mgpRequest(`/admin/users?${params}`)
  if (!res.ok) throw new Error('Failed to load users')
  return res.json()
}
export const updateUser = (id, data) => mgpRequest(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(r => r.json())
export const deleteUser = async (id) => {
  const res = await mgpRequest(`/admin/users/${id}`, { method: 'DELETE' })
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Delete failed') }
}

// Products
export const getProducts = (productType) => mgpRequest(`/admin/products${productType ? `?product_type=${productType}` : ''}`).then(r => r.json())
export const createProduct = (data) => mgpRequest('/admin/products', { method: 'POST', body: JSON.stringify(data) }).then(r => r.json())
export const updateProduct = (id, data) => mgpRequest(`/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(r => r.json())
export const deleteProduct = (id) => mgpRequest(`/admin/products/${id}`, { method: 'DELETE' })

// Settings
export const getSettings = () => mgpRequest('/admin/settings').then(r => r.json())
export const updateSetting = (key, payload) => mgpRequest(`/admin/settings/${key}`, { method: 'PATCH', body: JSON.stringify(payload) }).then(r => r.json())

// Credits — admin actions on user balances and project refunds.

async function _credits<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await mgpRequest(path, init)
  if (!res.ok) {
    let detail = 'Request failed'
    try { const j = await res.json(); detail = j.detail || detail } catch {}
    throw new Error(detail)
  }
  return res.json()
}

export const getCreditLedger = (
  userId: string,
  opts: { limit?: number; offset?: number; search?: string | null } = {},
) => {
  const { limit = 50, offset = 0, search = null } = opts
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (search && search.trim()) params.set('search', search.trim())
  return _credits(`/admin/users/${userId}/credits/ledger?${params}`)
}

export const grantCredits = (userId: string, payload: { amount: number; reason: string }) =>
  _credits(`/admin/users/${userId}/credits/grant`, { method: 'POST', body: JSON.stringify(payload) })

export const refundProjectCredits = (projectId: string, payload: { reason: string }) =>
  _credits(`/admin/projects/${projectId}/credits/refund`, { method: 'POST', body: JSON.stringify(payload) })

export const getPendingRefunds = (
  opts: { limit?: number; offset?: number; search?: string | null } = {},
) => {
  const { limit = 50, offset = 0, search = null } = opts
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (search && search.trim()) params.set('search', search.trim())
  return _credits(`/admin/projects/pending-refunds?${params}`)
}

export const dismissRefundInbox = async (projectId: string, payload: { reason?: string | null; undo?: boolean }) => {
  const res = await mgpRequest(`/admin/projects/${projectId}/refund-inbox/dismiss`, {
    method: 'POST',
    body: JSON.stringify({ reason: payload.reason ?? null, undo: !!payload.undo }),
  })
  if (!res.ok) {
    let detail = 'Request failed'
    try { const j = await res.json(); detail = j.detail || detail } catch {}
    throw new Error(detail)
  }
}
