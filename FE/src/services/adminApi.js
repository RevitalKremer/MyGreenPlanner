import { mgpRequest } from './mgpApi'

// Users
export const getUsers = () => mgpRequest('/admin/users').then(r => r.json())
export const updateUser = (id, data) => mgpRequest(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(r => r.json())
export const deleteUser = async (id) => {
  const res = await mgpRequest(`/admin/users/${id}`, { method: 'DELETE' })
  if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Delete failed') }
}

// Products
export const getProducts = () => mgpRequest('/admin/products').then(r => r.json())
export const createProduct = (data) => mgpRequest('/admin/products', { method: 'POST', body: JSON.stringify(data) }).then(r => r.json())
export const updateProduct = (id, data) => mgpRequest(`/admin/products/${id}`, { method: 'PUT', body: JSON.stringify(data) }).then(r => r.json())
export const deleteProduct = (id) => mgpRequest(`/admin/products/${id}`, { method: 'DELETE' })

// Settings
export const getSettings = () => mgpRequest('/admin/settings').then(r => r.json())
export const updateSetting = (key, payload) => mgpRequest(`/admin/settings/${key}`, { method: 'PATCH', body: JSON.stringify(payload) }).then(r => r.json())
