const MGP_API = import.meta.env.VITE_MGP_API_URL || '/api/mgp'

let accessToken = null

export const setAccessToken = (token) => { accessToken = token }
export const clearAccessToken = () => { accessToken = null }
export const getAccessToken = () => accessToken

async function _refreshAccessToken() {
  try {
    const res = await fetch(`${MGP_API}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) return null
    const data = await res.json()
    setAccessToken(data.access_token)
    return data.access_token
  } catch {
    return null
  }
}

export async function mgpRequest(path, options: Record<string, any> = {}) {
  const headers = { ...options.headers }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`

  let res = await fetch(`${MGP_API}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  // Auto-refresh on 401 and retry once
  if (res.status === 401 && accessToken) {
    const newToken = await _refreshAccessToken()
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`
      res = await fetch(`${MGP_API}${path}`, { ...options, headers, credentials: 'include' })
    }
  }

  return res
}
