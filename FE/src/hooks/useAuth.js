import { useState, useEffect, useCallback } from 'react'
import { mgpRequest, setAccessToken, clearAccessToken } from '../services/mgpApi'

const MGP_API = import.meta.env.VITE_MGP_API_URL || 'http://localhost/api/mgp'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)

  // Restore session from httpOnly refresh cookie on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${MGP_API}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          setAccessToken(data.access_token)
          const meRes = await mgpRequest('/auth/me')
          if (meRes.ok) setUser(await meRes.json())
        }
      } catch {}
      setAuthLoading(false)
    })()
  }, [])

  const login = useCallback(async (email, password) => {
    const res = await mgpRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Login failed')
    }
    const data = await res.json()
    setAccessToken(data.access_token)
    const meRes = await mgpRequest('/auth/me')
    const me = await meRes.json()
    setUser(me)
    return me
  }, [])

  const register = useCallback(async (email, password, fullName, phone) => {
    const res = await mgpRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, full_name: fullName, phone_number: phone || null }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Registration failed')
    }
    return login(email, password)
  }, [login])

  const logout = useCallback(async () => {
    await mgpRequest('/auth/logout', { method: 'POST' })
    clearAccessToken()
    setUser(null)
  }, [])

  const updateProfile = useCallback(async (data) => {
    const res = await mgpRequest('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Update failed')
    }
    const updated = await res.json()
    setUser(updated)
    return updated
  }, [])

  const forgotPassword = useCallback(async (email) => {
    const res = await mgpRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    })
    if (!res.ok) throw new Error('Request failed')
  }, [])

  const resetPassword = useCallback(async (token, newPassword) => {
    const res = await mgpRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, new_password: newPassword }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Reset failed')
    }
  }, [])

  const verifyEmail = useCallback(async (token) => {
    const res = await mgpRequest(`/auth/verify-email?token=${encodeURIComponent(token)}`)
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.detail || 'Verification failed')
    }
  }, [])

  return { user, authLoading, login, logout, register, updateProfile, forgotPassword, resetPassword, verifyEmail }
}
