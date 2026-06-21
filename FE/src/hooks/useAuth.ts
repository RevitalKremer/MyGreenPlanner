import { useState, useEffect, useCallback, useRef } from 'react'
import { mgpRequest, setAccessToken, clearAccessToken } from '../services/mgpApi'
import { TERMS_VERSION } from '../utils/legal'

const MGP_API = import.meta.env.VITE_MGP_API_URL || '/api/mgp'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(true)
  // Mirror of user used by visibility-change listener so it can no-op when
  // logged out without re-running the effect on every user change.
  const userRef = useRef(null)
  useEffect(() => { userRef.current = user }, [user])

  // Pull the latest /auth/me state — used after events that may have moved
  // the credit balance externally (admin grant/refund happening in another tab).
  const refreshMe = useCallback(async () => {
    const meRes = await mgpRequest('/auth/me')
    if (meRes.ok) {
      const me = await meRes.json()
      setUser(me)
      return me
    }
    return null
  }, [])

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

  // Pull a fresh /auth/me whenever the tab regains focus — catches credit
  // balance changes triggered by an admin grant/refund from another session.
  // No-op when logged out so we don't hammer the endpoint on every tab swap.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && userRef.current) {
        refreshMe().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshMe])

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

  const register = useCallback(async (email, password, fullName, phone, company) => {
    const res = await mgpRequest('/auth/register', {
      method: 'POST',
      // terms_accepted is gated by the consent checkbox in AuthModal — register()
      // is never reached without it. terms_version records the agreed revision.
      body: JSON.stringify({ email, password, full_name: fullName, phone_number: phone || null, company_name: company, terms_accepted: true, terms_version: TERMS_VERSION }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      // FastAPI 422 returns `detail` as an array of {msg,...}; a string otherwise.
      const detail = Array.isArray(err.detail) ? err.detail.map(d => d?.msg).filter(Boolean).join('; ') : err.detail
      throw new Error(detail || 'Registration failed')
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

  const resendVerification = useCallback(async () => {
    const res = await mgpRequest('/auth/resend-verification', { method: 'POST' })
    if (!res.ok) throw new Error('Failed to resend verification email')
  }, [])

  return { user, authLoading, login, logout, register, updateProfile, forgotPassword, resetPassword, verifyEmail, resendVerification, refreshMe }
}
